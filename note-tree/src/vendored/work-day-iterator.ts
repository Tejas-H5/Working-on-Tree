import { addDays, ONE_DAY, ONE_HOUR, ONE_MINUTE, parseIsoDate } from "./datetime";

export type Boolean7 = [boolean, boolean, boolean, boolean, boolean, boolean, boolean];

export type TaskCompletion = {
    remaining: number;
    taskId: number;
    date: Date;
};

export type TaskCompletions = {
    completions: TaskCompletion[];
    dayOffset: number;
    dateFloored: Date;
};

export type WorkdayConfigWeekDay = {
    dayStartHour: number;
    workingHours: number;
    // index 0 -> sunday
    weekdayFlags: Boolean7; // Could have been bitflags but no, we had to make it boolean[7]. xD
};

export type WorkdayConfigHoliday = {
    name: string;
    date: Date;
}

export type WorkdayConfig = {
    weekdayConfigs: WorkdayConfigWeekDay[];
    holidays: WorkdayConfigHoliday[];
};


type WorkdayIterator = {
    wc: WorkdayConfig;
    workdayOffset: number;
    weekday: number;
    date: Date;
    timeOfDayNow: number;
    startOfDay: number;
    endOfDay: number;
}

export function hasAnyTimeAtAll(wc: WorkdayConfig): boolean {
    for (const wd of wc.weekdayConfigs) {
        if (wd.weekdayFlags.some(f => f)) {
            if (wd.workingHours > 0) {
                return true;
            }
        }
    }

    return false;
}

const DAYS_IN_LIFETIME = 365 * 200;

export function advanceWorkdayIterator(it: WorkdayIterator, ms: number): boolean {
    let daysSimulated = 0;
    while (ms > 0) {
        if (daysSimulated > DAYS_IN_LIFETIME) {
            break;
        }

        const config = getTodayConfig(it);
        if (
            !config ||
            config.workingHours === 0 ||
            !config.weekdayFlags[it.weekday] ||
            isHoliday(it)
        ) {
            it.workdayOffset++;
            it.weekday = (it.weekday + 1) % 7;
            addDays(it.date, 1);
            resetIterator(it);
            daysSimulated++;
            continue;
        }

        const remainingTime = it.endOfDay - it.timeOfDayNow;

        if (ms - remainingTime < 0) {
            it.timeOfDayNow += ms;
            ms = 0;
        } else {
            ms -= remainingTime;
            it.workdayOffset++;
            it.weekday = (it.weekday + 1) % 7;
            addDays(it.date, 1);
            resetIterator(it);
            daysSimulated++;
            continue;
        }
    }

    return true;
}

function getTodayConfig(it: WorkdayIterator): WorkdayConfigWeekDay | undefined {
    let config: WorkdayConfigWeekDay | undefined;
    for (const c of it.wc.weekdayConfigs) {
        if (c.weekdayFlags[it.weekday]) {
            config = c;
            break;
        }
    }
    return config;
}

function isHoliday(it: WorkdayIterator): boolean {
    for (const wh of it.wc.holidays) {
        const date = getWorkdayConfigHolidayDate(wh);
        if (
            it.date.getFullYear() === date.getFullYear() && 
            it.date.getMonth() === date.getMonth() &&
            it.date.getDate() === date.getDate()
        ) {
            return true;
        }
    }

    return false;
}

function resetIterator(it: WorkdayIterator) {
    const config = getTodayConfig(it);

    if (!config) {
        it.startOfDay = 0;
        it.endOfDay = 0;
        it.timeOfDayNow = 0;
    } else {
        // We actually start this iterator at the current time _now_, and only use the dayStartHour for the following days.
        if (it.workdayOffset === 0) {
            const now = new Date();
            it.startOfDay = now.getHours() * ONE_HOUR + now.getMinutes() * ONE_MINUTE;
        } else {
            it.startOfDay = config.dayStartHour * ONE_HOUR;
        }
        // Assume we won't pull an all-nighter - limit endOfDay to 24 hrs
        it.endOfDay = Math.min(ONE_DAY, it.startOfDay + Math.max(config.workingHours, 0) * ONE_HOUR);
        it.timeOfDayNow = it.startOfDay;
    }
}


export function getWorkdayConfigHolidayDate(wh: WorkdayConfigHoliday): Date {
    if (!wh.date) {
        const date = parseIsoDate(wh.date);
        if (!date) {
            wh.date = new Date(NaN);
        } else {
            wh.date = date;
        }
    }

    return wh.date;
}

export function newWorkdayConfigWeekDay(dayStartHour: number = 0, workingHours: number = 0): WorkdayConfigWeekDay {
    return {
        dayStartHour,
        workingHours,
        weekdayFlags: [false, false, false, false, false, false, false],
    };
}

// Example usage (used to be a real usage but I deleted this feature)
// NOTE: calling this method will sort the holidays in the workday config
// export function predictTaskCompletions(
//     taskIds: number[], 
//     wc: WorkdayConfig,
//     dst: TaskCompletions[],
// ) {
//     dst.length = 0;
//
//     wc.holidays.sort((a, b) => {
//         return getWorkdayConfigHolidayDate(a).getTime() 
//             - getWorkdayConfigHolidayDate(b).getTime();
//     });
//
//     if (!hasAnyTimeAtAll(wc)) {
//         return;
//     }
//
//     const it: WorkdayIterator = { 
//         wc, startOfDay: 0, endOfDay: 0, timeOfDayNow: 0, workdayOffset: 0, 
//         weekday: (new Date()).getDay(),
//         date: new Date(),
//     };
//     floorDateLocalTime(it.date);
//     resetIterator(it);
//
//     for (let i = 0; i < noteIds.length; i++) {
//         const id = noteIds[i];
//         const note = getNote(state.notes, id);
//
//         let estimate = getNoteEstimate(note);
//         if (estimate === -1) {
//             estimate = 0;
//         }
//
//         const duration = getNoteDurationWithoutRange(state, note);
//         const remaining = estimate - duration;
//
//         advanceWorkdayIterator(it, remaining);
//
//         const estimatedCompletion = new Date();
//         floorDateLocalTime(estimatedCompletion);
//         addDays(estimatedCompletion, it.workdayOffset);
//         estimatedCompletion.setMilliseconds(it.timeOfDayNow);
//
//         const completion: TaskCompletion = { taskId: id, date: estimatedCompletion, remaining };
//
//         if (dst.length > 0) {
//             const lastCompletion = dst[dst.length - 1];
//             if (lastCompletion.dayOffset === it.workdayOffset) {
//                 lastCompletion.completions.push(completion);
//                 continue;
//             }
//         } 
//
//         const dateFloored = new Date(estimatedCompletion);
//         floorDateLocalTime(dateFloored);
//
//         dst.push({
//             dayOffset: it.workdayOffset,
//             dateFloored,
//             completions: [completion]
//         });
//     }
// }
