import * as tree from "src/utils/int-tree";
import {
    asArray,
    asNumber,
    asObject,
    asString,
    asStringMap,
    asTrue,
    deserializeObject,
    extractKey,
    mustGet
} from "src/utils/serialization-utils";
import { GraphData, newGraphEdge, newGraphNode } from "./legacy-app-components/interactive-graph-state";
import {
    Activity,
    defaultActivity,
    defaultNote,
    newNoteTreeGlobalState,
    newTaskStream,
    newWorkdayConfigWeekDay,
    Note,
    NoteId,
    NoteTreeGlobalState,
    TaskStream,
    TreeNote,
    WorkdayConfig,
    WorkdayConfigHoliday,
    WorkdayConfigWeekDay
} from "./state";
import { filterInPlace } from "./utils/array-utils";

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
        if (nodesArr) {
            // TODO: handle schema version 1.

            state.notes.nodes = nodesArr.map(nodeArrVal => {
                const nodeObj = mustGet(asObject(nodeArrVal));

                const noteObjDataObj = mustGet(asObject(extractKey<TreeNote>(nodeObj, "data")));
                const noteData = defaultNote();
                deserializeObject(noteData, noteObjDataObj, "note.nodes[].data");

                const node = tree.newTreeNode(noteData);

                node.childIds = mustGet(asNoteIds(extractKey<TreeNote>(nodeObj, "childIds")));

                deserializeObject(node, nodeObj, "note.nodes[]");

                return node;
            });
        }

        deserializeObject(state.notes, stateNotesObj, "notes");
    }

    const activitiesArr = mustGet(asArray(extractKey<NoteTreeGlobalState>(stateObj, "activities")))
    state.activities = activitiesArr.map(val => {
        const obj = mustGet(asObject(val));

        const activity = defaultActivity(new Date());

        activity.nId       = asNumber(extractKey<Activity>(obj, "nId")) as NoteId | undefined;
        activity.breakInfo = asString(extractKey<Activity>(obj, "breakInfo"));
        activity.locked    = asTrue(extractKey<Activity>(obj, "locked"));
        activity.deleted   = asTrue(extractKey<Activity>(obj, "deleted"));
        activity.c         = asNumber(extractKey<Activity>(obj, "c"));

        return activity;
    });
    filterInPlace(state.activities, a => a.breakInfo != null || a.nId != null);

    const taskStreamsArr = asArray(extractKey<NoteTreeGlobalState>(stateObj, "taskStreams"));
    if (taskStreamsArr) {
        state.taskStreams = taskStreamsArr.map(taskStreamVal => {
            const taskStreamObj = mustGet(asObject(taskStreamVal));

            const name = mustGet(asString(extractKey<TaskStream>(taskStreamObj, "name")));
            const taskStream = newTaskStream(name);

            taskStream.noteIds =  mustGet(asNoteIds(extractKey<TaskStream>(taskStreamObj, "noteIds")));

            deserializeObject(taskStream, taskStreamObj);

            return taskStream;
        });
    }

    const scheduledNoteIds = asNoteIds(extractKey<NoteTreeGlobalState>(stateObj, "scheduledNoteIds"));
    if (scheduledNoteIds) state.scheduledNoteIds = scheduledNoteIds;

    const workdayConfigObj = asObject(extractKey<NoteTreeGlobalState>(stateObj, "workdayConfig"));
    if (workdayConfigObj) {

        const weekdayConfigsArr = mustGet(asArray(extractKey<WorkdayConfig>(workdayConfigObj, "weekdayConfigs")));
        state.workdayConfig.weekdayConfigs = weekdayConfigsArr.map(u => {
            const weekdayConfigObj = mustGet(asObject(u));
            const weekdayConfig = newWorkdayConfigWeekDay();

            const weekdays = mustGet(asArray(extractKey<WorkdayConfigWeekDay>(weekdayConfigObj, "weekdayFlags")));
            for (let i = 0; i < weekdayConfig.weekdayFlags.length && i < weekdays.length; i++) {
                weekdayConfig.weekdayFlags[i] = !!weekdays[i];
            }

            deserializeObject(weekdayConfig, weekdayConfigObj);

            return weekdayConfig;
        });

        const holidayConfigsArr = mustGet(asArray(extractKey<WorkdayConfig>(workdayConfigObj, "holidays")));
        state.workdayConfig.holidays = holidayConfigsArr.map(u => {
            const holidayConfigObj = mustGet(asObject(u));
            const holidayConfig: WorkdayConfigHoliday = {
                name: "",
                date: new Date(),
            };
            deserializeObject(holidayConfig, holidayConfigObj);
            return holidayConfig;
        });
        
        deserializeObject(state.workdayConfig, workdayConfigObj);
    }

    const mainGraphDataObj = asObject(extractKey<NoteTreeGlobalState>(stateObj, "mainGraphData"));
    if (mainGraphDataObj) {
        state.mainGraphData.nodes = mustGet(asStringMap(extractKey<GraphData>(mainGraphDataObj, "nodes"), u => {
            const nodeObj = mustGet(asObject(u));
            const node = newGraphNode("", "", 0, 0);
            deserializeObject(node, nodeObj);
            return node;
        }));

        state.mainGraphData.edges = mustGet(asStringMap(extractKey<GraphData>(mainGraphDataObj, "edges"), u => {
            const edgeObj = mustGet(asObject(u));
            const edge = newGraphEdge("", "", 0)
            deserializeObject(edge, edgeObj);
            return edge;
        }));

        deserializeObject(state.mainGraphData, mainGraphDataObj);
    }

    deserializeObject(state, stateObj);

    return state;
}
