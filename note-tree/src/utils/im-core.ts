import { assert } from "src/utils/assert";

// Conventions
//  - All methods that increment the entry index or call methods that do so should be prefixed 'im'
//      - Methods that don't do this _should not_ be prefixed 'im'
//      - Some im methods push a new entry list and then pop it, or open/close a scope. The pairs should be named like `imThing` and `imThingEnd`. 
//      - Some im methods do not push a new list entry. You'll just have to know which one does which, or find out by reading through its source code.
//
// Other:
// - A bit of a dilemma. Apis like im<Thing><Action> are heirarchical. However APIs like im<Action><Thing> are more memorable.
//      E.g. imPushLayout instead of imLayoutPush. createBlah or blahCreate. new Class() vs Class::new(). 
//      I'm going with im<Thing><Action> for consistency and predicatbility, but it may not be ideal in all cases.



// NOTE: I've got no idea if this is actually faster than just using objects - I'm just trying something out.
// Migth be shit, and need rewriting to use normal objects, I've got no idea yet.

export type ImCacheEntries = any[];

// Somewhat important that we store these all at 0.

export const ENTRIES_IDX = 0;
export const ENTRIES_LAST_IDX = 1;
export const ENTRIES_REMOVE_LEVEL = 2;
export const ENTRIES_IS_IN_CONDITIONAL_PATHWAY = 3;
export const ENTRIES_IS_DERIVED = 4;
export const ENTRIES_STARTED_CONDITIONALLY_RENDERING = 5;
export const ENTRIES_DESTRUCTORS = 6;
export const ENTRIES_KEYED_MAP = 7;
export const ENTRIES_COMPLETED_ONE_RENDER = 8;
export const ENTRIES_INTERNAL_TYPE = 9;
export const ENTRIES_PARENT_TYPE = 10;
export const ENTRIES_PARENT_VALUE = 11;
export const ENTRIES_ITEMS_START = 12;

// Allows us to cache state for our immediate mode callsites.
// Initially started using array indices instead of object+fields to see what would happen.
// A lot of code paths have actually been simplified as a result at the expense of type safety... (worth it)
export type ImCache = (ImCacheEntries | any)[];
export const CACHE_IDX = 0;
export const CACHE_CURRENT_ENTRIES = 1;
export const CACHE_CURRENT_WAITING_FOR_SET = 2;
export const CACHE_CONTEXTS = 3;
export const CACHE_ROOT_ENTRIES = 4;
export const CACHE_NEEDS_RERENDER = 5;
export const CACHE_RERENDER_FN = 6;
export const CACHE_IS_RENDERING = 7;
export const CACHE_ANIMATE_FN = 8;
export const CACHE_ANIMATION_ID = 9;
export const CACHE_ANIMATION_TIME = 10;
export const CACHE_ANIMATION_DELTA_TIME_SECONDS = 11;
export const CACHE_ITEMS_ITERATED = 12;
export const CACHE_ENTRIES_START = 13;


// NOTE: this only works if you can somehow re-render your program whenever any error occurs.
// While you can just rerender this every frame in requestAnimationFrame (which is how I plan on using it),
// I am making it optional, hence CACHE_NEEDS_RERENDER. You could also just rerender on user events, and maintain a queue of 
// [cache, function] that need realtime updates.


export const REMOVE_LEVEL_NONE = 1;
export const REMOVE_LEVEL_DETATCHED = 2;
export const REMOVE_LEVEL_DESTROYED = 3;

export type RemovedLevel
    = typeof REMOVE_LEVEL_NONE
    | typeof REMOVE_LEVEL_DETATCHED   // This is the default remove level. The increase in performance far oughtweighs any memory problems. 
    | typeof REMOVE_LEVEL_DESTROYED;

// TypeIDs allow us to provide some basic sanity checks and protection
// against the possiblity of data corruption that can happen when im-state is accessed 
// conditionally or out of order. The idea is that rather than asking you to pass in 
// some random number, or to save a bunch of type ID integers everywhere, you can 
// just pass in a reference to a function to uniquely identify a piece of state.
// You probably have a whole bunch of them lying around somewhere.
// The function that you are creating the state from, for example. 
// The return value of the function can be used to infer the return value of
// the {@link imGetsState} call, but it can also be a completely unrelated function
// - in which case you can just use {@link imInlineTypeId}. As long as a function
// has been uniquely used within a particular entry list at a particular slot, the 
// likelyhood of out-of-order rendering errors will reduce to almost 0.
export type TypeId<T> = (...args: any[]) => T;

/**
 * Used when the return type of the typeId function has nothing to do with the contents of the state.
 * We still need some way to check for out-of-order rendering bugs, and you probably have a function or two nearby that you can use.
 * This is an alterantive to the prior implementation, which forced you to pollute your module scopes with named integers.
 *
 * ```ts
 * let pingPong; pingPong = imGet(c, inlineTypeId(Math.sin));
 * if (!pingPong) pingPong = imSet(c, { t: 0 });
 * ```
 */
export function inlineTypeId<T = undefined>(fn: Function) {
    return fn as TypeId<T>;
}

// Can be any valid object reference. Or string, but avoid string if you can - string comparisons are slower than object comparisons
export type ValidKey = string | number | Function | object | boolean | null | unknown;

export const USE_EVENT_LOOP = 1 << 0;
export const USE_ANIMATION_FRAME = 1 << 1;

/**
 * If you want to avoid requestAnimationFrame, then pass in the {@link USE_EVENT_LOOP} flag instead
 * of the default {@link USE_ANIMATION_FRAME} flag.
 *  - You'll need to manually call c[CACHE_RERENDER_FN]() whenever any state anywhere changes.
 *  - Methods that previously reported a deltaTime will report a constant 0.0333_ instead.
 *  - I'm not even sure why you would do this, but I've added it just in case.
 * 
 * NOTE: it is assumed that the rerender function and the `useEventLoop` parameter never changes.
 */
export function imCacheInit(
    c: ImCache,
    renderFn: (c: ImCache) => void,
    flags = USE_ANIMATION_FRAME
) {
    if (c.length === 0) {
        c.length = CACHE_ENTRIES_START;
        // starts at -1 and increments onto the current value. So we can keep accessing this idx over and over without doing idx - 1.
        // NOTE: memory access is supposedly far slower than math. So might not matter too much
        c[CACHE_IDX] = 0;
        c[CACHE_CONTEXTS] = [];
        c[CACHE_ROOT_ENTRIES] = [];
        c[CACHE_CURRENT_ENTRIES] = c[CACHE_ROOT_ENTRIES];
        c[CACHE_CURRENT_WAITING_FOR_SET] = false;
        c[CACHE_NEEDS_RERENDER] = false;
        c[CACHE_IS_RENDERING] = false;
        c[CACHE_ITEMS_ITERATED] = 0;
        c[CACHE_RERENDER_FN] = () => {
            if (c[CACHE_IS_RENDERING] === true) {
                c[CACHE_NEEDS_RERENDER] = true;
            } else {
                renderFn(c);
            }
        };
        if (flags & USE_EVENT_LOOP) {
            c[CACHE_ANIMATION_TIME] = 0;
            c[CACHE_ANIMATION_DELTA_TIME_SECONDS] = 1 / 30;
            c[CACHE_ANIMATE_FN] = noOp;
            c[CACHE_ANIMATION_ID] = null;
        } else if (flags & USE_ANIMATION_FRAME) {
            c[CACHE_ANIMATION_TIME] = 0;
            c[CACHE_ANIMATION_DELTA_TIME_SECONDS] = 0;
            c[CACHE_ANIMATE_FN] = (t: number) => {
                const lastT = c[CACHE_ANIMATION_TIME];
                c[CACHE_ANIMATION_TIME] = t;
                c[CACHE_ANIMATION_DELTA_TIME_SECONDS] = (t - lastT) / 1000.0;
                renderFn(c);
            };
            c[CACHE_ANIMATION_ID] = 0;
        } else {
            throw new Error("Invalid flags");
        }
    }

    c[CACHE_IDX] = CACHE_ENTRIES_START - 1;
    c[CACHE_NEEDS_RERENDER] = false;
    c[CACHE_ITEMS_ITERATED] = 0;
    c[CACHE_CURRENT_WAITING_FOR_SET] = false;
    c[CACHE_IS_RENDERING] = true;

    imCacheEntriesPush(c, c[CACHE_ROOT_ENTRIES], imCacheInit, c, INTERNAL_TYPE_CACHE);

    return c;
}

function noOp() {}

export function imCacheInitEnd(c: ImCache) {
    imCacheEntriesPop(c);

    const startIdx = CACHE_ENTRIES_START - 1;
    if (c[CACHE_IDX] > startIdx) {
        console.error("You've forgotten to pop some things: ", c.slice(startIdx + 1));
        throw new Error("You've forgotten to pop some things");
    } else if (c[CACHE_IDX] < startIdx) {
        throw new Error("You've popped too many thigns off the stack!!!!");
    }

    const needsRerender = c[CACHE_NEEDS_RERENDER];
    if (needsRerender === true) {
        // Some things may occur while we're rendering the framework that require is to immediately rerender
        // our components to not have a stale UI. Those events will set this flag to true, so that
        // We can eventually reach here, and do a full rerender.
        c[CACHE_NEEDS_RERENDER] = false;
        // Other things need to rerender the cache long after we've done a render. Mainly, DOM UI events - 
        // once we get the event, we trigger a full rerender, and pull the event out of state and use it's result in the process.
        c[CACHE_RERENDER_FN]();

        c[CACHE_IS_RENDERING] = false;
    } else if (c[CACHE_ANIMATE_FN] !== noOp) {
        // paranoid about starting multiple animations side by side, which kills performance and introduces various bugs.
        // cancelling the prior animation should do it
        cancelAnimationFrame(c[CACHE_ANIMATION_ID]);
        c[CACHE_ANIMATION_ID] = requestAnimationFrame(c[CACHE_ANIMATE_FN]);
        c[CACHE_IS_RENDERING] = true;
    }
}

const INTERNAL_TYPE_NORMAL_BLOCK = 1;
const INTERNAL_TYPE_CONDITIONAL_BLOCK = 2;
const INTERNAL_TYPE_ARRAY_BLOCK = 3;
const INTERNAL_TYPE_KEYED_BLOCK = 4;
const INTERNAL_TYPE_TRY_BLOCK = 5;
const INTERNAL_TYPE_CACHE = 6;

export function imCacheEntriesPush<T>(
    c: ImCache,
    entries: ImCacheEntries,
    parentTypeId: TypeId<T>,
    parent: T,
    internalType: number,
) {
    const idx = ++c[CACHE_IDX];
    if (idx === c.length) {
        c.push(entries);
    } else {
        c[idx] = entries;
    }

    c[CACHE_CURRENT_ENTRIES] = entries;

    if (entries.length === 0) {
        entries.length = ENTRIES_ITEMS_START;
        entries[ENTRIES_IDX] = ENTRIES_ITEMS_START - 2;
        entries[ENTRIES_LAST_IDX] = ENTRIES_ITEMS_START - 2;
        entries[ENTRIES_REMOVE_LEVEL] = REMOVE_LEVEL_DETATCHED;
        entries[ENTRIES_IS_IN_CONDITIONAL_PATHWAY] = false;
        entries[ENTRIES_IS_DERIVED] = false;
        entries[ENTRIES_STARTED_CONDITIONALLY_RENDERING] = false;
        entries[ENTRIES_PARENT_TYPE] = parentTypeId;
        entries[ENTRIES_INTERNAL_TYPE] = internalType;
        entries[ENTRIES_COMPLETED_ONE_RENDER] = false;
        entries[ENTRIES_PARENT_VALUE] = parent;
        entries[ENTRIES_DESTRUCTORS] = undefined;
        entries[ENTRIES_KEYED_MAP] = undefined;
    } else {
        assert(entries[ENTRIES_PARENT_TYPE] === parentTypeId);
    }

    entries[ENTRIES_IDX] = ENTRIES_ITEMS_START - 2;
}

export function imCacheEntriesPop(c: ImCache) {
    const idx = --c[CACHE_IDX];
    c[CACHE_CURRENT_ENTRIES] = c[idx];
    assert(idx >= CACHE_ENTRIES_START - 1);
}

export function imGet<T>(c: ImCache, typeId: TypeId<T>): T | undefined {
    const entries = c[CACHE_CURRENT_ENTRIES];
    c[CACHE_ITEMS_ITERATED]++;

    // Make sure you called imSet for the previous state before calling imGet again.
    assert(!c[CACHE_CURRENT_WAITING_FOR_SET]);

    entries[ENTRIES_IDX] += 2;
    const idx = entries[ENTRIES_IDX];
    if (idx === ENTRIES_ITEMS_START) {
        // Need to respond to conditional rendering when we render the first item, because rendering 0 items is the signal to not conditionally render.
        if (entries[ENTRIES_IS_IN_CONDITIONAL_PATHWAY] === false) {
            entries[ENTRIES_IS_IN_CONDITIONAL_PATHWAY] = true;
            entries[ENTRIES_STARTED_CONDITIONALLY_RENDERING] = true;
            entries[ENTRIES_REMOVE_LEVEL] = REMOVE_LEVEL_NONE;
        } else {
            // NOTE: if an error occured in the previous render, then
            // subsequent things that depended on `startedConditionallyRendering` being true won't run.
            // I think this is better than re-running all the things that ran successfully over and over again.
            entries[ENTRIES_STARTED_CONDITIONALLY_RENDERING] = false;
        }
    }

    if (idx === entries.length) {
        entries.push(typeId);
        entries.push(undefined);
        c[CACHE_CURRENT_WAITING_FOR_SET] = true;
    } else if (idx < entries.length) {
        assert(entries[idx] === typeId);
    } else {
        throw new Error("Shouldn't reach here");
    }

    return entries[idx + 1];
}

export function getEntryAt<T>(c: ImCache, typeId: TypeId<T>, idx: number): T {
    const entries = c[CACHE_CURRENT_ENTRIES];
    const type = entries.at(ENTRIES_ITEMS_START + idx);
    if (type !== typeId) {
        throw new Error("Didn't find <typeId::" + typeId.name + "> at " + idx);
    }

    const val = entries[ENTRIES_ITEMS_START + idx + 1];
    return val as T;
}


export function getEntriesParent<T>(c: ImCache, typeId: TypeId<T>): T {
    // If this assertion fails, then you may have forgotten to pop some things you've pushed onto the stack
    const entries = c[CACHE_CURRENT_ENTRIES];
    assert(entries[ENTRIES_PARENT_TYPE] === typeId);
    return entries[ENTRIES_PARENT_VALUE] as T;
}


export function imSet<T>(c: ImCache, val: T): T {
    const entries = c[CACHE_CURRENT_ENTRIES];
    const idx = entries[ENTRIES_IDX];
    entries[idx + 1] = val;
    c[CACHE_CURRENT_WAITING_FOR_SET] = false;
    return val;
}

type ListMapBlock = { rendered: boolean; entries: ImCacheEntries; };


function __imBlockKeyed(c: ImCache, key: ValidKey) {
    const entries = c[CACHE_CURRENT_ENTRIES];

    let map = entries[ENTRIES_KEYED_MAP] as (Map<ValidKey, ListMapBlock> | undefined);
    if (map === undefined) {
        map = new Map<ValidKey, ListMapBlock>();
        entries[ENTRIES_KEYED_MAP] = map;
    }

    let block = map.get(key);
    if (block === undefined) {
        block = { rendered: false, entries: [] };
        map.set(key, block);
    }

    /**
     * You're rendering this list element twice. You may have duplicate keys in your dataset.
     * If that is not the case, a more common cause is that you are mutating collections while iterating them.
     * All sorts of bugs and performance issues tend to arise when I 'gracefully' handle this case, so I've just thrown an exception instead.
     *
     * If you're doing this in an infrequent event, here's a quick fix:
     * {
     *      let deferredAction: () => {};
     *      imCacheListItem(s);
     *      for (item of list) {
     *          if (event) deferredAction = () => literally same mutation
     *      }
     *      imCacheListItemEnd(s);
     *      if (deferredAction !== undefined) deferredAction();
     * }
     */
    if (block.rendered === true) throw new Error(
        "You've requested the same list key twice. This is indicative of a bug. The comment above this exception will explain more."
    );

    block.rendered = true;

    const parentType = entries[ENTRIES_PARENT_TYPE];
    const parent = entries[ENTRIES_PARENT_VALUE];
    imCacheEntriesPush(c, block.entries, parentType, parent, INTERNAL_TYPE_KEYED_BLOCK);
}

/**
 * Allows you to reuse the same component for the same key.
 * This key is local to the current entry list, and not global to the entire im-cache.
 *
 * ```ts
 * imFor(c); for (const val of list) {
 *      imKeyed(c, val); { ... } imKeyedEnd(c);
 * } imForEnd(c);
 * ```
 */
export function imKeyed(c: ImCache, key: ValidKey) {
    __imBlockKeyed(c, key);
}

export function imKeyedEnd(c: ImCache) {
    __imBlockDerivedEnd(c, INTERNAL_TYPE_KEYED_BLOCK);
}

// You probably don't need a destructor unless you're being forced to add/remove callbacks or 'clean up' something
export function imCacheEntriesAddDestructor(c: ImCache, destructor: () => void) {
    const entries = c[CACHE_CURRENT_ENTRIES];
    let destructors = entries[ENTRIES_DESTRUCTORS];
    if (destructors === undefined) {
        destructors = [];
        entries[ENTRIES_DESTRUCTORS] = destructors;
    }

    destructors.push(destructor);
}

export function imCacheEntriesOnRemove(entries: ImCacheEntries) {
    // don't re-traverse these items.
    if (entries[ENTRIES_IS_IN_CONDITIONAL_PATHWAY] === true) {
        entries[ENTRIES_IS_IN_CONDITIONAL_PATHWAY] = false;

        for (let i = ENTRIES_ITEMS_START; i < entries.length; i += 2) {
            const t = entries[i];
            const v = entries[i + 1];
            if (t === imBlock) {
                imCacheEntriesOnRemove(v);
            }
        }
    }
}

export function imCacheEntriesOnDestroy(entries: ImCacheEntries) {
    // don't re-traverse these items.
    if (entries[ENTRIES_REMOVE_LEVEL] < REMOVE_LEVEL_DESTROYED) {
        entries[ENTRIES_REMOVE_LEVEL] = REMOVE_LEVEL_DESTROYED;

        for (let i = ENTRIES_ITEMS_START; i < entries.length; i += 2) {
            const t = entries[i];
            const v = entries[i + 1];
            if (t === imBlock) {
                imCacheEntriesOnDestroy(v);
            }
        }

        const destructors = entries[ENTRIES_DESTRUCTORS];
        if (destructors !== undefined) {
            for (const d of destructors) {
                try {
                    d();
                } catch (e) {
                    console.error("A destructor threw an error: ", e);
                }
            }
            entries[ENTRIES_DESTRUCTORS] = undefined;
        }
    }
}

export function imBlock<T>(
    c: ImCache,
    parentTypeId: TypeId<T>,
    parent: T,
    internalType: number = INTERNAL_TYPE_NORMAL_BLOCK
): ImCacheEntries {
    let entries; entries = imGet(c, imBlock);
    if (entries === undefined) entries = imSet(c, []);

    imCacheEntriesPush(c, entries, parentTypeId, parent, internalType);

    const map = entries[ENTRIES_KEYED_MAP] as (Map<ValidKey, ListMapBlock> | undefined);
    if (map !== undefined) {
        // TODO: maintain a list of things we rendered last frame.
        // This map may become massive depending on how caching has been configured.
        for (const v of map.values()) {
            v.rendered = false;
        }
    }

    return entries;
}

export function imBlockEnd(c: ImCache, internalType: number = INTERNAL_TYPE_NORMAL_BLOCK) {
    const entries = c[CACHE_CURRENT_ENTRIES];
    let map = entries[ENTRIES_KEYED_MAP] as (Map<ValidKey, ListMapBlock> | undefined);

    // Opening and closing blocks may not be lining up right.
    // You may have missed or inserted some blocks by accident.
    assert(entries[ENTRIES_INTERNAL_TYPE] === internalType);

    if (map !== undefined) {
        // TODO: Blocks need to either have a 'REMOVE_LEVEL_DETATCHED' or a 'REMOVE_LEVEL_DESTROYED' so that
        // we know what to do with the things we didn't render. For now, defaulting to DETATCHED
        for (const v of map.values()) {
            if (!v.rendered) {
                imCacheEntriesOnRemove(v.entries);
            }
        }
    }

    const idx = entries[ENTRIES_IDX];
    entries[ENTRIES_COMPLETED_ONE_RENDER] = true;
    const lastIdx = entries[ENTRIES_LAST_IDX];
    if (idx !== ENTRIES_ITEMS_START - 2) {
        if (lastIdx === ENTRIES_ITEMS_START - 2) {
            entries[ENTRIES_LAST_IDX] = idx;
        } else if (idx !== lastIdx) {
            throw new Error("You should be rendering the same number of things in every render cycle");
        }
    }

    return imCacheEntriesPop(c);
}

export function __imBlockDerived(c: ImCache, internalType: number): ImCacheEntries {
    const entries = c[CACHE_CURRENT_ENTRIES];
    const parentType = entries[ENTRIES_PARENT_TYPE];
    const parent = entries[ENTRIES_PARENT_VALUE];

    return imBlock(c, parentType, parent, internalType);
}

export function isFirstishRender(c: ImCache): boolean {
    const entries = c[CACHE_CURRENT_ENTRIES];
    return entries[ENTRIES_COMPLETED_ONE_RENDER] === false;
}

export function __imBlockDerivedEnd(c: ImCache, internalType: number) {
    // The DOM appender will automatically update and diff the children if they've changed.
    // However we can't just do
    // ```
    // if (blah) {
    //      new component here
    // }
    // ```
    //
    // Because this would de-sync the immediate mode call-sites from their positions in the cache entries.
    // But simply putting them in another entry list:
    //
    // imConditionalBlock();
    // if (blah) {
    // }
    // imConditionalBlockEnd();
    //
    // Will automatically isolate the next immediate mode call-sites with zero further effort required,
    // because all the entries will go into a single array which always takes up just 1 slot in the entries list.
    // It's a bit confusing why there isn't more logic here though, I guess.
    //
    // NOTE: I've now moved this functionality into core. Your immediate mode tree builder will need
    // to resolve diffs in basically the same way.

    imBlockEnd(c, internalType);
}

/**
 * I could write a massive doc here explaning how {@link imIf], {@link imIfElse} and {@link imIfEnd} work.
 * but it may be more effective to just arrange the methods one after the other:
 */

export function imIf(c: ImCache): true {
    __imBlockArray(c);
    __imBlockConditional(c);
    return true;
}

export function imIfElse(c: ImCache): true {
    __imBlockConditionalEnd(c);
    __imBlockConditional(c);
    return true;
}

export function imIfEnd(c: ImCache) {
    __imBlockConditionalEnd(c);
    __imBlockArrayEnd(c);
}

/**
 * ```ts
 * imSwitch(c, key) switch (key) {
 *      case a: { ... } break;
 *      case b: { ... } break;
 *      case c: { ... } break;
 * } imSwitchEnd(c);
 * ```
 * NOTE: doesn't work as you would expect when you use fallthrough, so don't use fallthrough with imSwitch.
 * Use if-else + imIf/imIfElse/imIfEnd instead.
 */
export function imSwitch(c: ImCache, key: ValidKey) {
    __imBlockKeyed(c, key);
}

export function imSwitchEnd(c: ImCache) {
    __imBlockDerivedEnd(c, INTERNAL_TYPE_KEYED_BLOCK);
}

function __imBlockArray(c: ImCache) {
    __imBlockDerived(c, INTERNAL_TYPE_ARRAY_BLOCK);
}

function __imBlockConditional(c: ImCache) {
    __imBlockDerived(c, INTERNAL_TYPE_CONDITIONAL_BLOCK);
}

function __imBlockConditionalEnd(c: ImCache) {
    const entries = c[CACHE_CURRENT_ENTRIES];
    if (entries[ENTRIES_IDX] === ENTRIES_ITEMS_START - 2) {
        imCacheEntriesOnRemove(entries);
    }

    __imBlockDerivedEnd(c, INTERNAL_TYPE_CONDITIONAL_BLOCK);
}

export function imFor(c: ImCache) {
    __imBlockArray(c);
}

export function imForEnd(c: ImCache) {
    __imBlockArrayEnd(c);
}

function __imBlockArrayEnd(c: ImCache) {
    const entries = c[CACHE_CURRENT_ENTRIES]

    const idx = entries[ENTRIES_IDX];
    const lastIdx = entries[ENTRIES_LAST_IDX];
    if (idx < lastIdx) {
        // These entries have left the conditional rendering pathway
        for (let i = idx + 2; i <= lastIdx; i += 2) {
            const t = entries[i];
            const v = entries[i + 1];
            if (t === imBlock) {
                imCacheEntriesOnRemove(v);
            }
        }
    }

    // we allow growing or shrinking this kind of block in particular
    entries[ENTRIES_LAST_IDX] = idx;

    __imBlockDerivedEnd(c, INTERNAL_TYPE_ARRAY_BLOCK);
}


export const MEMO_NOT_CHANGED = 0;
/** returned by {@link imMemo} if the value changed */
export const MEMO_CHANGED = 1;
/** 
 * returned by {@link imMemo} if this is simply the first render. 
 * Most of the time the distinction is not important, but sometimes,
 * you want to happen on a change but NOT the initial renderer.
 */
export const MEMO_FIRST_RENDER = 2;
/** 
 * returned by {@link imMemo} if this is is caused by the component
 * re-entering the conditional rendering codepath.
 */
export const MEMO_FIRST_RENDER_CONDITIONAL = 3;

export type ImMemoResult
    = typeof MEMO_NOT_CHANGED
    | typeof MEMO_CHANGED
    | typeof MEMO_FIRST_RENDER_CONDITIONAL;

/**
 * Returns non-zero when:
 *  - val was different from the last value, 
 *  - the component wasn't in the conditional rendering pathway before,
 *    but it is now
 *
 * There are a lot of times where things need to be recomputed
 * based on values, as well as when a component re-enters the view.
 * In fact, you probably want this most of the time.
 */
export function imMemo(c: ImCache, val: unknown): ImMemoResult {
    /**
     * NOTE: I had previously implemented imMemo() and imMemoEnd():
     *
     * if (imBeginMemo().val(x).objectVals(obj)) {
     *      <Memoized component>
     * } imEndMemo();
     * ```
     * It can be done, but I've found that it's a terrible idea in practice.
     * I had initially thought {@link imMemo} was bad too, but it has turned out to be very useful.
     *
     * let result: ImMemoResult = MEMO_NOT_CHANGED; 
     */

    let result: ImMemoResult = MEMO_NOT_CHANGED;

    const entries = c[CACHE_CURRENT_ENTRIES];

    let lastVal = imGet(c, inlineTypeId(imMemo));
    if (lastVal !== val) {
        imSet(c, val);
        result = MEMO_CHANGED;
    } else if (entries[ENTRIES_STARTED_CONDITIONALLY_RENDERING] === true) {
        result = MEMO_FIRST_RENDER_CONDITIONAL;
    }

    return result;
}

export function imChanged(c: ImCache, val: unknown): boolean {
    let result = false;
    if (imGet(c, imChanged) !== val) {
        result = true;
        imSet(c, val);
    }
    return result;
}

export type TryState = {
    entries: ImCacheEntries,
    err: any | null;
    recover: () => void;
    // TODO: consider Map<Error, count: number>
};

export function imTry(c: ImCache): TryState {
    const entries = __imBlockDerived(c, INTERNAL_TYPE_TRY_BLOCK);

    let tryState = imGet(c, imTry);
    if (tryState === undefined) {
        const val: TryState = {
            err: null,
            recover: () => {
                val.err = null;
                c[CACHE_NEEDS_RERENDER] = true;
            },
            entries,
        };
        tryState = imSet(c, val);
    }

    return tryState;
}

export function imTryCatch(c: ImCache, tryState: TryState, err: any) {
    if (tryState.err != null) {
        throw new Error("Your error boundary pathway also has an error in it, so we can't recover!");
    }

    c[CACHE_NEEDS_RERENDER] = true;
    tryState.err = err;
    const idx = c.lastIndexOf(tryState.entries);
    if (idx === -1) {
        throw new Error("Couldn't find the entries in the stack to unwind to!");
    }

    c[CACHE_IDX] = idx;
    c[CACHE_CURRENT_ENTRIES] = c[idx];
}

export function imTryEnd(c: ImCache, tryState: TryState) {
    const entries = c[CACHE_CURRENT_ENTRIES];
    assert(entries === tryState.entries);
    __imBlockDerivedEnd(c, INTERNAL_TYPE_TRY_BLOCK);
}

export function getDeltaTimeSeconds(c: ImCache): number {
    return c[CACHE_ANIMATION_DELTA_TIME_SECONDS];
}
