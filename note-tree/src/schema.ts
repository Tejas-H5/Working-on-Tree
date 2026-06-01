import * as tree from "src/utils/int-tree";
import {
    asArray,
    asBoolean,
    asDate,
    asNull,
    asNumber,
    asObject,
    asString,
    asTrue,
    deserializeObject,
    extractKey,
    mustGet,
    serializeToJSON,
} from "src/utils/serialization-utils";
import { ConceptSubset, MappingGraph, newConceptSubset, newGraphMappingConcept, newGraphMappingRelationship } from "./app-views/graph-view";
import { getOrCreateJournalLogPageForDate, Journal, JournalPage, newJournalPage, TreePage } from "./app-views/journal-view";
import {
    Activity,
    defaultActivity,
    defaultNote,
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
import { TreeId } from "src/utils/int-tree";

function asNoteIds(val: unknown) {
    return asArray(val, (n): n is tree.TreeId => typeof n === "number");
}

export function asNoteTreeGlobalState(val: unknown) {
    const stateObj = asObject(val);
    if (stateObj === undefined) throw new Error("Expected an object as input");

    const state = newNoteTreeGlobalState();

    const noteTreeObj = asObject(extractKey<NoteTreeGlobalState>(stateObj, "noteTree"))
    if (noteTreeObj) {
        const noteTreeNotesObj = asObject(extractKey<NoteTree>(noteTreeObj, "notes"));
        if (noteTreeNotesObj) {
            const nodesArr = asArray(extractKey<tree.TreeStore<Note>>(noteTreeNotesObj, "nodes"));
            if (nodesArr) {
                state.noteTree.notes.nodes = nodesArr.map(asTreeNoteOrNull);
            }

            deserializeObject(state.noteTree.notes, noteTreeNotesObj);
        }

        const rootMarksArr = asArray(extractKey<NoteTree>(noteTreeObj, "rootMarks"));
        if (rootMarksArr) {
            state.noteTree.rootMarks = rootMarksArr.map(val => (asNumber(val) as NoteId | undefined) ?? null);
        }

        deserializeObject(state.noteTree, noteTreeObj);
    }

    type NoteTreeGlobalStateLegacy = {
        notes                 : TreeNoteTree;
        textOnArrivalNoteId   : NoteId;
        textOnArrival         : string;
        currentNoteId         : NoteId;
        rootMarks: (NoteId | null)[];
    }

    const stateNotesObj = asObject(extractKey<NoteTreeGlobalStateLegacy>(stateObj, "notes"));
    if (stateNotesObj) {
        // We need to migrate the old data onto the new data

        const nodesArr = asArray(extractKey<tree.TreeStore<Note>>(stateNotesObj, "nodes"));
        if (nodesArr) {
            state.noteTree.notes.nodes = nodesArr.map(asTreeNoteOrNull);
        }

        deserializeObject(state.noteTree.notes, stateNotesObj, "notes");

        // Pull these off the main object
        state.noteTree.textOnArrivalNoteId   = mustGet(asNumber(extractKey<NoteTreeGlobalStateLegacy>(stateObj, "textOnArrivalNoteId")) as TreeId);
        state.noteTree.textOnArrival         = mustGet(asString(extractKey<NoteTreeGlobalStateLegacy>(stateObj, "textOnArrival")));
        state.noteTree.currentNoteId         = mustGet(asNumber(extractKey<NoteTreeGlobalStateLegacy>(stateObj, "currentNoteId")) as TreeId);

        const rootMarksArr = asArray(extractKey<NoteTreeGlobalStateLegacy>(stateObj, "rootMarks"));
        if (rootMarksArr) {
            state.noteTree.rootMarks = rootMarksArr.map(val => (asNumber(val) as NoteId | undefined) ?? null);
        }
    }

    const activitiesArr = mustGetDefined(asArray(extractKey<NoteTreeGlobalState>(stateObj, "activities")))
    state.activities = activitiesArr.map((val, i) => {
        const activityObj = mustGetDefined(asObject(val));

        const t = mustGetDefined(asDate(extractKey<Activity>(activityObj, "t")));
        const activity = defaultActivity(t);

        activity.nId       = asNumber(extractKey<Activity>(activityObj, "nId")) as NoteId | undefined;
        activity.breakInfo = asString(extractKey<Activity>(activityObj, "breakInfo"));
        activity.locked    = asTrue(extractKey<Activity>(activityObj, "locked"));
        activity.deleted   = asTrue(extractKey<Activity>(activityObj, "deleted"));
        activity.c         = asNumber(extractKey<Activity>(activityObj, "c"));

        const journalObj = asObject(extractKey<Activity>(activityObj, "journal"));
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

    const mappingGraphObj = asObject(extractKey<NoteTreeGlobalState>(stateObj, "mappingGraph"));
    if (mappingGraphObj) {
        state.mappingGraph = asMappingGraph(mappingGraphObj, state.mappingGraph);
    }

    const journalObj = asObject(extractKey<NoteTreeGlobalState>(stateObj, "journal"));
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

        const pagesObj = mustGetDefined(asObject(extractKey<Journal>(journalObj, "pages")));
        const nodesArr = mustGetDefined(asArray(extractKey<tree.TreeStore<Note>>(pagesObj, "nodes")));
        state.journal.pages.nodes = nodesArr.map((val) => {
            const obj = asObject(val);
            if (!obj) return null;
            const node: TreePage = tree.newTreeNode(newJournalPage(""));

            // Broo I cant be bothered. TODO: We need to figure out a better way to parse the schema, or stor the data
            // in such a way that this isn't such a big deal. This code should work though - we just
            // won't get the same hidden class, which. who cares at this point.
            node.childIds = mustGetDefined(asNoteIds(extractKey<TreePage>(obj, "childIds")));
            node.data     = mustGetDefined(asObject(extractKey<TreePage>(obj, "data"))) as JournalPage;

            deserializeObject(node, obj, "state.journal.pages.nodes[]");
            return node;
        });

        deserializeObject(state.journal.pages, pagesObj);

        // @ts-expect-error We've removed entries in favour of a dedicated journal page.
        // This code handles the migration.
        // TODO: remap journal activities {type, idx} type of journal -> the page we moved it to
        const entries = asArray(extractKey<Journal>(journalObj, "entries"));
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

    deserializeObject(state, stateObj);

    // Perform migrations
    {
        // Delete migrations when they have been successfully applied on all target deployments
    }

    return state;
}

function asMappingGraph(mappingGraphObj: Record<string, unknown>, defaultValue: MappingGraph): MappingGraph {
    const concepts = mustGetDefined(asArray(extractKey<MappingGraph>(mappingGraphObj, "concepts")));

    defaultValue.concepts = concepts.map(conceptVal => {
        const obj = asObject(conceptVal);
        if (!obj) return null;

        const value = newGraphMappingConcept(-1, -1, "");
        deserializeObject(value, obj, "mappingGraph.concepts");
        return value;
    });

    const relationships = mustGetDefined(asArray(extractKey<MappingGraph>(mappingGraphObj, "relationships")));
    defaultValue.relationships = relationships.map(relationshipVal => {
        const obj = asObject(relationshipVal);
        if (!obj) return null;
        
        const value = newGraphMappingRelationship(-1, -1, "");
        deserializeObject(value, obj, "mappingGraph.concepts");
        return value;
    });

    const subsets = asArray(extractKey<MappingGraph>(mappingGraphObj, "subsets"));
    if (subsets) {
        defaultValue.subsets = subsets.map(subsetsVal => {
            const obj = mustGetDefined(asObject(subsetsVal));
            const value = newConceptSubset();

            const subsets = mustGetDefined(asArray(extractKey<ConceptSubset>(obj, "conceptIds")));
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

    const noteObjDataObj = mustGetDefined(asObject(extractKey<TreeNote>(nodeObj, "data")));
    const noteData = defaultNote();

    deserializeObject(noteData, noteObjDataObj, "note.nodes[].data");

    const node = tree.newTreeNode(noteData);

    node.childIds = mustGetDefined(asNoteIds(extractKey<TreeNote>(nodeObj, "childIds")));

    deserializeObject(node, nodeObj, "note.nodes[]");

    return node;
}
