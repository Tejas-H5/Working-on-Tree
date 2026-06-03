import * as tree from "src/utils/int-tree";
import { TreeId } from "src/utils/int-tree";
import {
    asArray,
    asDate,
    asNull,
    asNumber,
    asObject,
    asString,
    asTrue,
    deserializeObject,
    getArray,
    getVal,
    getObject,
    mustGetArray,
    mustGetObject,
    mustGet,
    LoadedObject,
    serializeToJSON
} from "src/utils/serialization-utils";
import { ConceptSubset, GraphMappingConcept, GraphMappingRelationship, MappingGraph, newConceptSubset, newGraphMappingConcept, newGraphMappingRelationship, newMappingGraph, newMappingGraphView } from "./app-views/graph-view";
import { addJournalPageUnder, getOrCreateJournalLogPageForDate, Journal, JournalPage, newJournalPage, TreePage } from "./app-views/journal-view";
import {
    Activity,
    defaultActivity,
    defaultNote,
    newNoteTree,
    newNoteTreeGlobalState,
    Note,
    NoteId,
    NoteTree,
    NoteTreeGlobalState,
    TreeNote,
    TreeNoteTree
} from "./state";
import { filterInPlace } from "./utils/array-utils";
import { mustGetDefined } from "./utils/assert";
import { formatIsoDate } from "./utils/datetime";

function asNoteIds(val: unknown) {
    return asArray(val, (n): n is tree.TreeId => typeof n === "number");
}

export function asNoteTreeGlobalState(val: unknown) {
    const stateObj = asObject<NoteTreeGlobalState>(val);
    if (stateObj === undefined) throw new Error("Expected an object as input");

    const state = newNoteTreeGlobalState();

    type NoteTreeGlobalStateLegacy = {
        notes                 : TreeNoteTree;
        textOnArrivalNoteId   : NoteId;
        textOnArrival         : string;
        currentNoteId         : NoteId;
        rootMarks: (NoteId | null)[];
    }

    const stateNotesObj = getObject(stateObj as LoadedObject<NoteTreeGlobalStateLegacy>, "notes");
    if (stateNotesObj) {
        // We need to migrate the old data onto the new data

        const nodesArr = asArray(getVal<tree.TreeStore<Note>>(stateNotesObj, "nodes"));
        if (nodesArr) {
            state._noteTree.notes.nodes = nodesArr.map(asTreeNoteOrNull);
        }

        deserializeObject(state._noteTree.notes, stateNotesObj, "notes");

        // Pull these off the main object
        state._noteTree.textOnArrivalNoteId   = mustGet(asNumber(getVal<NoteTreeGlobalStateLegacy>(stateObj, "textOnArrivalNoteId")) as TreeId);
        state._noteTree.textOnArrival         = mustGet(asString(getVal<NoteTreeGlobalStateLegacy>(stateObj, "textOnArrival")));
        state._noteTree.currentNoteId         = mustGet(asNumber(getVal<NoteTreeGlobalStateLegacy>(stateObj, "currentNoteId")) as TreeId);

        const rootMarksArr = getArray(stateObj as LoadedObject<NoteTreeGlobalStateLegacy>, "rootMarks")
        if (rootMarksArr) {
            state._noteTree.rootMarks = rootMarksArr.map(val => (asNumber(val) as NoteId | undefined) ?? null);
        }
    }

    // second in-flight state migration ...
    type NoteTreeGlobalStateLegacy2 = {
        noteTree: NoteTree;
    }

    const noteTreeObj = getObject(stateObj as LoadedObject<NoteTreeGlobalStateLegacy2>, "noteTree");
    if (noteTreeObj) {
        const noteTreeNotesObj = getObject(noteTreeObj, "notes");
        if (noteTreeNotesObj) {
            const nodesArr = getArray(noteTreeNotesObj, "nodes")
            if (nodesArr) {
                state._noteTree.notes.nodes = nodesArr.map(asTreeNoteOrNull);
            }

            deserializeObject(state._noteTree.notes, noteTreeNotesObj);
        }

        const rootMarksArr = getArray(noteTreeObj, "rootMarks");
        if (rootMarksArr) {
            state._noteTree.rootMarks = rootMarksArr.map(val => (asNumber(val) as NoteId | undefined) ?? null);
        }

        deserializeObject(state._noteTree, noteTreeObj);
    }

    const activitiesArr = mustGetArray(stateObj, "activities")
    state.activities = activitiesArr.map((val, i) => {
        const activityObj = mustGetDefined(asObject(val));

        const t = mustGetDefined(asDate(getVal(activityObj, "t")));
        const activity = defaultActivity(t);

        activity.nId       = asNumber(getVal(activityObj, "nId")) as NoteId | undefined;
        activity.breakInfo = asString(getVal(activityObj, "breakInfo"));
        activity.locked    = asTrue(getVal(activityObj, "locked"));
        activity.deleted   = asTrue(getVal(activityObj, "deleted"));
        activity.c         = asNumber(getVal(activityObj, "c"));

        const journalObj = asObject(getVal<Activity>(activityObj, "journal"));
        if (journalObj) {
            // @ts-expect-error type: 0 required for backwards compatibility
            activity.journal = { type: 0, idx: 0 };
            deserializeObject(activity.journal!, journalObj, "activity.journal");
        }

        deserializeObject(activity, activityObj, "activities");

        return activity;
    });
    filterInPlace(state.activities, a => a.breakInfo != null || a.nId != null || !!a.journal);

    // self-healing code. fr fr. Also not sure if good idea or shit idea
    {
        let sorted = true;
        for (let i = 1; i < state.activities.length; i++) {
            if (state.activities[i - 1].t.getTime() > state.activities[i].t.getTime()) {
                sorted = false;
                break;
            }
        }

        if (!sorted) {
            console.error("Activities weren't sorted. But we can just sort them tho?");
            state.activities.sort((a, b) => a.t.getTime() - b.t.getTime());
        }
    }

    const mappingGraphObj = getObject(stateObj, "mappingGraph")
    if (mappingGraphObj) {
        state.mappingGraph = asMappingGraph(mappingGraphObj, state.mappingGraph);
    }

    const journalObj = getObject(stateObj, "journal");
    if (journalObj) {
        // legacy method
        function newJournalEntry(name: string, createdAt = new Date()): JournalEntry {
            return {
                date: formatIsoDate(createdAt),
                page: newJournalPage(name, createdAt),
            };
        }

        // legacy type
        type JournalEntry = {
            date: string; // yyyy-mm-dd
            page: JournalPage;
        };

        const pagesObj = mustGetDefined(asObject(getVal<Journal>(journalObj, "pages")));
        const nodesArr = mustGetDefined(asArray(getVal<tree.TreeStore<Note>>(pagesObj, "nodes")));
        state.journal.pages.nodes = nodesArr.map((val) => {
            const obj = asObject<TreePage>(val);
            if (!obj) return null;

            const node = tree.newTreeNode(newJournalPage(""));

            node.childIds = asNoteIds(mustGetArray(obj, "childIds"))!;

            const dataObj = mustGetObject(obj, "data");
            node.data = asJournalPage(dataObj, node.data);

            deserializeObject(node, obj, "state.journal.pages.nodes[]");
            return node;
        });

        deserializeObject(state.journal.pages, pagesObj);

        // @ts-expect-error We've removed entries in favour of a dedicated journal page.
        // This code handles the migration.
        // TODO: remap journal activities {type, idx} type of journal -> the page we moved it to
        const entries = asArray(getVal<Journal>(journalObj, "entries"));
        if (entries) {
            const oldEntries = entries.map((val) => {
                const obj = mustGetDefined(asObject(val));
                const value = newJournalEntry("");

                deserializeObject(value, obj, "state.journal.entries");
                return value;
            });
            const remap = new Map<number, number>();
            let pageIdx = 0;
            for (const entry of oldEntries) {
                if (pageIdx > 0) {
                    const date = new Date(entry.page.name)
                    const page = getOrCreateJournalLogPageForDate(state.journal, date)
                    page.data.content = entry.page.content;
                    remap.set(pageIdx, page.id)
                }
                pageIdx += 1;
            }
            const JOURNAL_TYPE_JOURNAL = 1; // const JOURNAL_TYPE_PAGE    = 2;
            for (const activity of state.activities) {
                if (activity.journal) {
                    // @ts-expect-error .type is a legacy field
                    if (activity.journal.type === JOURNAL_TYPE_JOURNAL) {
                        const remapped = remap.get(activity.journal.idx);
                        if (remapped !== undefined) {
                            activity.journal.idx = remapped
                        }
                    }
                }
            }
        }

        deserializeObject(state.journal, journalObj);
    }

    if (state._noteTree.notes.nodes.length > 1) {
        const root = tree.getNode(state.journal.pages, tree.ROOT_ID);
        const page = addJournalPageUnder(state.journal, root, "Legacy notes", "These were the notes you used to have in your note tree. We've moved over to the journal pattern now because it's way cooler and way better! You can still access your old notes here though.")
        page.data.noteTree = state._noteTree;
        state._noteTree = newNoteTree();

        for (const activity of state.activities) {
            if (activity.nId) {
                activity.journal = { idx: page.id }
            }
        }
    }

    deserializeObject(state, stateObj);

    // Perform migrations
    {
        // Delete migrations when they have been successfully applied on all target deployments
    }

    return state;
}

function asMappingGraph(mappingGraphObj: LoadedObject<MappingGraph>, defaultValue: MappingGraph): MappingGraph {
    const concepts = mustGetArray(mappingGraphObj, "concepts");

    defaultValue.concepts = concepts.map(conceptVal => {
        const obj = asObject<GraphMappingConcept>(conceptVal);
        if (!obj) return null;

        const value = newGraphMappingConcept(-1, -1, "");
        deserializeObject(value, obj, "mappingGraph.concepts");
        return value;
    });

    const relationships = mustGetDefined(asArray(getVal<MappingGraph>(mappingGraphObj, "relationships")));
    defaultValue.relationships = relationships.map(relationshipVal => {
        const obj = asObject<GraphMappingRelationship>(relationshipVal);
        if (!obj) return null;
        
        const value = newGraphMappingRelationship(-1, -1, "");
        deserializeObject(value, obj, "mappingGraph.concepts");
        return value;
    });

    const subsets = asArray(getVal<MappingGraph>(mappingGraphObj, "subsets"));
    if (subsets) {
        defaultValue.subsets = subsets.map(subsetsVal => {
            const obj = mustGetDefined(asObject<ConceptSubset>(subsetsVal));
            const value = newConceptSubset();

            const subsets = mustGetArray(obj, "conceptIds")
            value.conceptIds = subsets.map(u => mustGetDefined(asNumber(u)));

            deserializeObject(value, obj, "mappingGraph.subsets");
            return value;
        });
    }

    deserializeObject(defaultValue, mappingGraphObj);
    return defaultValue;
}


// Validate schema parsing logic.
// It's easy to add new default state that will load fine untill we set it for the first time.
// To validate that all default state is deserialized, we can just serialize/deserialize a default object.
export function validateSchemas() {
    const defaultTree = newNoteTreeGlobalState();
    const serialized = JSON.parse(serializeToJSON(defaultTree));
    asNoteTreeGlobalState(serialized);
}

function asTreeNoteOrNull(nodeArrVal: unknown): TreeNote | null {
    const nodeObj = mustGetDefined(asObject(nodeArrVal) || asNull(nodeArrVal));
    if (nodeObj === null) return null;

    const noteObjDataObj = mustGetDefined(asObject(getVal<TreeNote>(nodeObj, "data")));
    const noteData = defaultNote();

    deserializeObject(noteData, noteObjDataObj, "note.nodes[].data");

    const node = tree.newTreeNode(noteData);

    node.childIds = mustGetDefined(asNoteIds(getVal<TreeNote>(nodeObj, "childIds")));

    deserializeObject(node, nodeObj, "note.nodes[]");

    return node;
}

function asNoteTree(noteTreeObj: LoadedObject<NoteTree>, noteTree: NoteTree): NoteTree {
    const noteTreeNotesObj = getObject(noteTreeObj, "notes");
    if (noteTreeNotesObj) {
        const nodesArr = asArray(getVal<tree.TreeStore<Note>>(noteTreeNotesObj, "nodes"));
        if (nodesArr) {
            noteTree.notes.nodes = nodesArr.map(asTreeNoteOrNull);
        }

        deserializeObject(noteTree.notes, noteTreeNotesObj);
    }

    const rootMarksArr = asArray(getVal<NoteTree>(noteTreeObj, "rootMarks"));
    if (rootMarksArr) {
        noteTree.rootMarks = rootMarksArr.map(val => (asNumber(val) as NoteId | undefined) ?? null);
    }

    deserializeObject(noteTree, noteTreeObj);

    return noteTree;
}

function asJournalPage(pageObj: LoadedObject<JournalPage>, page: JournalPage): JournalPage {
    const graphObj = getObject(pageObj, "graph")
    if (graphObj) {
        page.graph = {
            g: newMappingGraph(),
            v: newMappingGraphView(),
        };
        const gObj = mustGetObject(graphObj, "g")
        page.graph.g = asMappingGraph(gObj, page.graph.g)

        deserializeObject(page.graph, graphObj);
    }

    const noteTreeObj = getObject(pageObj, "noteTree");
    if (noteTreeObj) {
        page.noteTree = asNoteTree(noteTreeObj, newNoteTree());
    }

    deserializeObject(page, pageObj);

    return page;
}
