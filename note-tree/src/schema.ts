import * as tree from "src/utils/int-tree";
import {
    asArray,
    asDate,
    asNull,
    asNumber,
    asObject,
    asString,
    asTrue,
    deserializeObject,
    extractKey,
    serializeToJSON,
} from "src/utils/serialization-utils";
import { ConceptSubset, MappingGraph, newConceptSubset, newGraphMappingConcept, newGraphMappingRelationship } from "./app-views/graph-view";
import {
    Activity,
    defaultActivity,
    defaultNote,
    DONE_SUFFIX,
    getNote,
    idIsNilOrRoot,
    newNoteTreeGlobalState,
    Note,
    NoteId,
    NoteTreeGlobalState,
    recomputeNoteStatusRecursivelyLegacyComputation,
    STATUS_ASSUMED_DONE,
    STATUS_DONE,
    TreeNote
} from "./state";
import { filterInPlace } from "./utils/array-utils";
import { mustGetDefined } from "./utils/assert";
import { logTrace } from "./utils/log";

function asNoteIds(val: unknown) {
    return asArray(val, (n): n is tree.TreeId => typeof n === "number");
}

export function asNoteTreeGlobalState(val: unknown) {
    const stateObj = asObject(val);
    if (stateObj === undefined) throw new Error("Expected an object as input");
    
    const state = newNoteTreeGlobalState();

    const stateNotesObj = asObject(extractKey<NoteTreeGlobalState>(stateObj, "notes"));
    if (stateNotesObj) {
        const nodesArr = asArray(extractKey<tree.TreeStore<Note>>(stateNotesObj, "nodes"));
        let editedAtNeedsBackfill = false;

        if (nodesArr) {
            // NOTE: we no longer handle schema 1. All 2 users (both of which are me) have migrated off it.

            state.notes.nodes = nodesArr.map(nodeArrVal => {
                const nodeObj = mustGetDefined(asObject(nodeArrVal) || asNull(nodeArrVal));
                if (nodeObj === null) return null;

                const noteObjDataObj = mustGetDefined(asObject(extractKey<TreeNote>(nodeObj, "data")));
                const noteData = defaultNote();

                const editedAt = asDate(extractKey<Note>(noteObjDataObj, "editedAt"));
                if (editedAt) {
                    noteData.editedAt = editedAt;
                } else {
                    editedAtNeedsBackfill = true;
                }

                deserializeObject(noteData, noteObjDataObj, "note.nodes[].data");

                const node = tree.newTreeNode(noteData);

                node.childIds = mustGetDefined(asNoteIds(extractKey<TreeNote>(nodeObj, "childIds")));

                deserializeObject(node, nodeObj, "note.nodes[]");

                return node;
            });
        }

        deserializeObject(state.notes, stateNotesObj, "notes");

        if (editedAtNeedsBackfill) {
            for (const note of state.notes.nodes) {
                if (!note) continue;
                if (note.childIds.length > 0) continue;
                
                let current = note;
                const editedAt = note.data.openedAt;
                while (!idIsNilOrRoot(current.id)) {
                    current.data.editedAt = new Date(editedAt);
                    current = getNote(state.notes, current.parentId);
                }
            }
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

        deserializeObject(activity, activityObj, "activities");

        return activity;
    });
    filterInPlace(state.activities, a => a.breakInfo != null || a.nId != null);

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
        const concepts = mustGetDefined(asArray(extractKey<MappingGraph>(mappingGraphObj, "concepts")));
        state.mappingGraph.concepts = concepts.map(conceptVal => {
            const obj = asObject(conceptVal);
            if (!obj) return null;

            const value = newGraphMappingConcept(-1, -1, "");
            deserializeObject(value, obj, "mappingGraph.concepts");
            return value;
        });

        const relationships = mustGetDefined(asArray(extractKey<MappingGraph>(mappingGraphObj, "relationships")));
        state.mappingGraph.relationships = relationships.map(relationshipVal => {
            const obj = asObject(relationshipVal);
            if (!obj) return null;
            
            const value = newGraphMappingRelationship(-1, -1, "");
            deserializeObject(value, obj, "mappingGraph.concepts");
            return value;
        });

        const subsets = asArray(extractKey<MappingGraph>(mappingGraphObj, "subsets"));
        if (subsets) {
            state.mappingGraph.subsets = subsets.map(subsetsVal => {
                const obj = mustGetDefined(asObject(subsetsVal));
                const value = newConceptSubset();

                const subsets = mustGetDefined(asArray(extractKey<ConceptSubset>(obj, "conceptIds")));
                value.conceptIds = subsets.map(u => mustGetDefined(asNumber(u)));

                deserializeObject(value, obj, "mappingGraph.subsets");
                return value;
            });
        }

        deserializeObject(state.mappingGraph, mappingGraphObj);
    }

    const rootMarksArr = asArray(extractKey<NoteTreeGlobalState>(stateObj, "rootMarks"));
    if (rootMarksArr) {
        state.rootMarks = rootMarksArr.map(val => (asNumber(val) as NoteId | undefined) ?? null);
    }

    deserializeObject(state, stateObj);

    // Perform migrations
    {
        // Replace ASSUMED_DONE with DONE status
        if (!state.schemaMajorVersion || state.schemaMajorVersion < 3) {
            logTrace("migrating to schema major version 3");
            state.schemaMajorVersion = 3;
            let numBackfilled = 0;
            recomputeNoteStatusRecursivelyLegacyComputation(state, tree.getNode(state.notes, tree.ROOT_ID), true, true);
            tree.forEachNode(state.notes, note => {
                if (
                    note.data._status === STATUS_ASSUMED_DONE ||
                    note.data._status === STATUS_DONE
                ) {
                    if (!note.data.text.endsWith(DONE_SUFFIX)) {
                        note.data.text += DONE_SUFFIX;
                        note.data._status = STATUS_DONE;
                        numBackfilled += 1;
                    }
                }
            });
            logTrace("notes backfilled: " + numBackfilled);
        }
    }

    return state;
}


// Validate schema parsing logic.
// It's easy to add new default state that will load fine untill we set it for the first time.
// To validate that all default state is deserialized, we can just serialize/deserialize a default object.
export function validateSchemas() {
    const defaultTree = newNoteTreeGlobalState();
    const serialized = JSON.parse(serializeToJSON(defaultTree));
    asNoteTreeGlobalState(serialized);
}
