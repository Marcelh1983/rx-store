import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import firebase from 'firebase/app';

let functionRegion: Region;
let app: firebase.app.App;
let functions: firebase.functions.Functions;
let firestore: firebase.firestore.Firestore;
let storage: firebase.storage.Storage;
let auth: firebase.auth.Auth;
let logActionOptions: SyncOptions;

export interface StoreType<T> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    subscribe: (setState: ((state: T) => void)) => Subscription;
    asObservable: Observable<T>;
    dispatch: (action: ActionType<T, unknown>) => Promise<T>;
    currentState: () => T;
    addCallback: (callback: (action: ActionType<T, unknown>, oldState: T, newState: T, context: Map<string, unknown>) => void) => void
}

export interface ActionType<T, P> {
    neverStoreOrLog?: boolean;
    type: string;
    payload?: P;
    execute: (ctx: StateContextType<T>) => Promise<T>;
}

export interface StateContextType<T> {
    functions: firebase.functions.Functions;
    firestore: firebase.firestore.Firestore;
    storage: firebase.storage.Storage;
    auth: firebase.auth.Auth;

    getContext: <ContextType> (name: string) => ContextType;
    dispatch: (action: ActionType<T, unknown>) => Promise<T>;
    getState: () => T;
    setState: (state: T) => Promise<T>;
    patchState: (state: Partial<T>) => Promise<T>;
}

// eslint-disable-next-line @typescript-eslint/ban-types
export const initStore = (firebaseApp: firebase.app.App, region?: Region, syncOptions?: SyncOptions) => {
    app = firebaseApp;
    if (region) {
        functionRegion = region;
    }
    if (syncOptions) {
        logActionOptions = syncOptions;
    }
};

const storeContext = new Map<string, unknown>();

export const setStoreContext = (context: { name: string, dependency: unknown }[]) => {
    context.forEach(c => {
        if (storeContext.get(c.name)) {
            console.warn(`${c.name} is already added in the store context. Overriding current value`);
        }
        storeContext.set(c.name, c.dependency);
    });
};

export class StateContext<T> implements StateContextType<T>  {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(public ctx: BehaviorSubject<T>) { }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dispatch = (action: ActionType<T, unknown>) => action.execute(this as any); // trick compiler here
    getContext<T2>(name: string) {
        return storeContext.get(name) as T2;
    }
    getState = () => this.ctx.getValue();

    setState = (state: T) => {
        const updatedState = { ...state };
        this.ctx.next(updatedState);
        return Promise.resolve(updatedState);
    }
    patchState = (state: Partial<T>) => {
        const current = this.ctx.getValue();
        const merged = { ...current, ...state } as T;
        this.ctx.next(merged);
        return Promise.resolve(merged);
    }

    get functions() {
        if (!app) { console.error('firebase not initialize') }
        if (!functions) {
            functions = app.functions();
            if (functionRegion) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (functions as any)['region'] = functionRegion;
            }
        }
        return functions;
    }
    get firestore() {
        if (!app) { console.error('firebase not initialize') }
        if (!firestore) {
            firestore = app.firestore();
        }
        return firestore;
    }

    get storage() {
        if (!app) { console.error('firebase not initialize') }
        if (!storage) {
            storage = app.storage();
        }
        return storage;
    }

    get auth() {
        if (!app) { console.error('firebase not initialize') }
        if (!auth) {
            auth = app.auth();
        }
        return auth;
    }
}

export type Region = 'us-central1' | 'us-east1' | 'us-east4' | 'europe-west1' | 'europe-west2' | 'asia-east2' | 'asia-northeast1' |
    'asia-northeast2' | 'us-west2' | 'us-west3' | 'us-west4' | 'europe-west3' | 'europe-west6' | 'northamerica-northeast1' |
    'southamerica-east1' | 'australia-southeast1' | 'asia-south1' | 'asia-southeast2' | 'asia-northeast3';

export interface SyncOptions {
    collectionName?: string;
    addUserId: boolean;
    logAction?: boolean;
}

export function createStore<T>(initialState: T, devTools = false, syncOption?: SyncOptions): StoreType<T> {
    const subject = new BehaviorSubject<T>(initialState);
    const ctx = new StateContext(subject);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let devToolsDispacher: any = null;
    if (devTools) {
        devToolsDispacher = getDevToolsDispatcher(subject.getValue());
    }
    const callbacks: ((action: ActionType<T, unknown>, oldState: T, newState: T, context: Map<string, unknown>) => void)[] = [];

    const store: StoreType<T> = {
        subscribe: (setState) => subject.subscribe(setState),
        asObservable: subject.asObservable(),
        dispatch: async (action: ActionType<T, unknown>) => {
            const newState = await action.execute(ctx);
            if (devTools && devToolsDispacher) {
                devToolsDispacher(action, newState);
            }
            for (const callback of callbacks) {
                callback(JSON.parse(JSON.stringify(action)) as ActionType<T, unknown>, ctx.getState(), newState, storeContext);
            }
            return newState;

        },
        currentState: () => subject.getValue(),
        addCallback: (callback: (action: ActionType<T, unknown>, oldState: T, newState: T, context: Map<string, unknown>) => void) => {
            callbacks.push(callback);
        }

    }
    ctx.dispatch = store.dispatch;
    if (syncOption) {
        if (!auth || !auth.currentUser?.uid) { console.error('cannot (re)store state if firebase auth is not configured or user is not logged in.'); }
        // restore the state based on the current user. Make sure the user is already logged in before calling the createStore method.
        auth.onAuthStateChanged(user => {
            if (user) {
                firestore.doc(`${syncOption.collectionName}/${user.uid}`).get().then(ref => {
                    const state = ref.data() as T;
                    ctx.setState(state);
                });
            }
        })
        store.addCallback((_action: ActionType<T, unknown>, _oldState: T, newState: T) => {
            if (auth.currentUser) {
                if (syncOption.addUserId !== false) {
                    newState = { ...newState, createdBy: auth.currentUser?.uid };
                }
                firestore.doc(`${syncOption.collectionName}/${auth.currentUser.uid}`).set(newState);
            } else {
                console.error('cannot store state when user is not logged in.')
            }
        });
        if (logActionOptions && !(syncOption?.logAction === false)) {
            store.addCallback((action: ActionType<T, unknown>) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                let actionToStore = action as any;
                if (logActionOptions.addUserId) {
                    if (!auth) { console.error('cannot store state if firebase auth is not configured.'); }
                    const currentUser = auth.currentUser;
                    if (currentUser?.uid) {
                        if (syncOption.addUserId !== false) {
                            actionToStore = { ...actionToStore, createdBy: currentUser?.uid };
                        }
                    }
                }
                firestore.doc(`${logActionOptions.collectionName}/${dateId()}`).set(actionToStore);
            });
        }
    }
    return store;
}

function getDevToolsDispatcher<T>(currentState: T) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const devTools = (window as any).__REDUX_DEVTOOLS_EXTENSION__?.connect({});
    devTools?.init(currentState);

    return function (action: ActionType<T, unknown>, currentState: T) {
        devTools?.send(action.type, currentState);
    };
}

export const dateId = () => {
    const dt = new Date();
    const year = dt.getFullYear();
    const month = (dt.getMonth() + 1).toString().padStart(2, "0");
    const day = dt.getDate().toString().padStart(2, "0");
    const hour = (dt.getHours()).toString().padStart(2, "0");
    const minutes = (dt.getMinutes()).toString().padStart(2, "0");
    const seconds = (dt.getSeconds()).toString().padStart(2, "0");
    const milliseconds = (dt.getMilliseconds()).toString().padStart(3, "0");
    return `${year}${month}${day}${hour}${minutes}${seconds}${milliseconds}`;
}

