import { assert } from "./assert";
import {
    isDigit,
    newParser,
    Parser,
    parserAdvanceWhitespace,
    parserGet,
    parserParseDelimter,
    parserParseInt,
    parserParseKeyword
} from "./parser";

export const DAYS_OF_THE_WEEK_ABBREVIATED = [
    "Sun",
    "Mon",
    "Tue",
    "Wed",
    "Thu",
    "Fri",
    "Sat",
];


// NOTE: seperator used to be used to remove slashes so that this would be a valid file name.
// now, we use it to animate the clock...
export function formatDateTime(date: Date | null, seperator?: string, dayOfTheWeek = false, useSeconds = false) {
    const dateFormatted = formatDate(date, dayOfTheWeek);
    const timeFormatted = formatTime(date, seperator, useSeconds);
    return `${dateFormatted} ${timeFormatted}`;
}

export function formatTimeForInput(
    date: Date | null,
    seperator = ":",
    useSeconds = false
) {
    if (!date) {
        return "";
    }
    return formatTime(date, seperator, useSeconds);
}

export function formatTime(
    date: Date | null,
    seperator = ":",
    useSeconds = false
) {
    if (!date) {
        return `--${seperator}--${useSeconds ? (seperator + "--") : ""} --`;
    }

    const hours = date.getHours();
    const minutes = date.getMinutes();
    const seconds = date.getSeconds();

    const hoursStr = pad2(((hours - 1) % 12) + 1);
    const minStr = pad2(minutes);
    const secondsStr = useSeconds ? `${seperator}${pad2(seconds)}` : "";
    const amPmStr = hours < 12 ? "am" : "pm";

    return `${hoursStr}${seperator}${minStr}${secondsStr} ${amPmStr}`;
}


export function formatDate(date: Date | null, dayOfTheWeek = false) {
    if (!date) {
        const dayOfTheWeekStr = !dayOfTheWeek ? "" : ("---" + " ");
        return `${dayOfTheWeekStr}${getDatePlaceholder("--", "--", "----")}`;
    }

    // TODO: use inferMmDdYyyyOrder here

    const dd = date.getDate();
    const mm = date.getMonth() + 1;
    const yyyy = date.getFullYear();

    const dayOfTheWeekStr = !dayOfTheWeek ? "" : (DAYS_OF_THE_WEEK_ABBREVIATED[date.getDay()] + " ");
    return `${dayOfTheWeekStr}${pad2(dd)}/${pad2(mm)}/${yyyy}`;
}

// Compares dates, ignoring the time component
export function isSameDate(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() &&
           a.getMonth() === b.getMonth() &&
           a.getDate() === b.getDate();
}

export function isDayBefore(a: Date, b: Date) {
    return a.getTime() < b.getTime() && !isSameDate(a, b);
}

export function clampDate(date: Date, lowerBound: Date | null, upperBound: Date | null): Date {
    date = new Date(date);

    if (upperBound && date.getTime() > upperBound.getTime()) {
        date.setTime(upperBound.getTime() - 1);
    }
    if (lowerBound && date.getTime() < lowerBound.getTime()) {
        date.setTime(lowerBound.getTime() + 1);
    }
    return date;
}

export function cloneDate(date: Date | null): Date | null {
    if (date === null) return null;
    return new Date(date);
}

export function pad2(num: number) {
    return num < 10 ? "0" + num : "" + num;
}

/** NOTE: won't work for len < 3 */
export function truncate(str: string, len: number): string {
    if (str.length > len) {
        return str.substring(0, len - 3) + "...";
    }

    return str;
}

type ErrorString = string;
export function parseYMDTDateTime(value: string): [Date | null, ErrorString] {
    // Picking a date with the default calender (i.e type="datetime-local" or similar) is always a PAIN. 
    // Especially when you have a very specific thing you're trying to do.
    // I reckon I'll just stick to an input format like 
    // 06/04/2024 05:41 pm

    // Possibly over-lenient date time regex
    // "06/04/2024 05:41 pm".match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)?/)

    // TODO: use parser

    const regex = /(\w+ )?(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)?/;
    const matches = value.match(regex);
    if (!matches) {
        return [null, "Couldn't find a date"];
    }

    const [
        _dayStr,
        _matchStr,
        dateStr,
        monthStr,
        yearStr,
        hrStr,
        minStr,
        amPmStr
    ] = matches;

    const date = new Date(0);
    date.setFullYear(parseInt(yearStr))
    date.setMonth(parseInt(monthStr) - 1)
    date.setDate(parseInt(dateStr))

    let hrs = parseInt(hrStr);
    if (amPmStr) {
        if (hrs < 0 || hrs > 12) {
            return [null, "Hours must be 0 <= hrs <= 12"];
        }

        if (amPmStr === "pm" && hrs !== 12) {
            hrs += 12;
        }
    } else {
        if (hrs < 0 || hrs >= 24) {
            return [null, "Hours must be 0 <= hrs <= 23"];
        }
    }
    date.setHours(hrs);

    const mins = parseInt(minStr);
    if (mins < 0 || mins >= 60) {
        return [null, "Mins must be 0 <= min <= 59"];
    }
    date.setMinutes(mins);
    date.setSeconds(0);
    date.setMilliseconds(0);

    if (
        date.getDate() !== parseInt(dateStr) ||
        (date.getMonth() + 1) !== parseInt(monthStr) ||
        date.getFullYear() !== parseInt(yearStr) ||
        date.getHours() !== hrs ||
        date.getMinutes() !== mins
    ) {
        return [null, "Date was not valid"]
    }

    return [date, ""];
}


export type HoursMinutes = {
    hours: number;
    minutes: number;
};

// returns a string with a time scoped to today's date.
export function parseTimeInput(str: string, today: Date): [HoursMinutes, string | null] {
    const p = newParser(str);

    const hm: HoursMinutes = { hours: 0, minutes: 0 };

    parserAdvanceWhitespace(p);
    let hours = parserParseInt(p);
    if (hours === null) return [hm, "Missing hours"];

    let minutes = 0;
    parserAdvanceWhitespace(p);
    if (parserParseDelimter(p, ":")) {
        parserAdvanceWhitespace(p);
        const minutesMaybe = parserParseInt(p);
        if (minutesMaybe !== null) minutes = minutesMaybe;
    } else if (!parserAtEnd(p)) {
        // we also allow just '10' to mean 10 oclock (infer am or pm from previousTime)
        return [hm, "Expected : seperator here"];
    }

    parserAdvanceWhitespace(p);
    let isAm = parserParseKeyword(p, "am") || parserParseKeyword(p, "AM");
    let isPm = !isAm && (parserParseKeyword(p, "pm") || parserParseKeyword(p, "PM"));
    if (!isAm && !isPm) {
        // Infer AM/PM from 'now'
        isAm = today.getHours() < 12; isPm = !isAm;
    }

    if (hours < 12 && isPm) hours += 12;
    
    return [{ hours, minutes }, null];
}

export function parserAtEnd(p: Parser) {
    return parserGet(p).length === 0;
}

export function parseDurationInput(str: string): [number, string | null] {
    const p = newParser(str);

    let duration = 0;
    let entries = 0;

    while (!parserAtEnd(p)) {
        parserAdvanceWhitespace(p);
        let time = parserParseInt(p);
        if (time === null) return [0, "Expected whole number"]; // TODO: decimal number

        parserAdvanceWhitespace(p);
        const isH = parserParseKeyword(p, "h");
        const isM = !isH && parserParseKeyword(p, "m");

        if (!isH && !isM) {
            if (entries === 0 && parserAtEnd(p)) {
                // infer based on how big the number is. iff it's the only entry.
                // arbitrary threhshold.
                if (time > 12) {
                    return [time * ONE_MINUTE, null];
                }
                return [time * ONE_HOUR, null];
            }

            return [0, "Expected 'h' or 'm'"];
        }

        if (isH) {
            duration += time * ONE_HOUR;
        } else if (isM) {
            duration += time * ONE_MINUTE;
        } else {
            // Should have handled every unit.
            assert(false);
        }

        entries++;
    }

    if (entries === 0) {
        return [0, "Missing input"];
    }

    return [duration, null];
}

export function dateSetLocalTime(date: Date, time: HoursMinutes) {
    date.setHours(time.hours);
    date.setMinutes(time.minutes);
    date.setSeconds(0, 0);
}

export function floorDateLocalTime(date: Date) {
    date.setHours(0, 0, 0, 0);
}

export function floorDateToWeekLocalTime(date: Date) {
    floorDateLocalTime(date);
    const dayOfWeek = date.getDay();
    addDays(date, -dayOfWeek);
}

export function addDays(date: Date, days: number) {
    date.setDate(date.getDate() + days)
}

export function addHours(date: Date, hours: number) {
    date.setHours(date.getHours() + hours);
}

export function addMinutes(date: Date, minutes: number) {
    date.setMinutes(date.getMinutes() + minutes);
}

export function roundToNearestMinutes(date: Date, minuteSnap: number) {
    date.setMinutes(Math.floor(date.getMinutes() / minuteSnap) * minuteSnap);
}

// 1 work day is actually 7.5 hours.
export function formatDurationInWorkdays(ms: number): string {
    const workDayHours = 7.5;
    const hours = (ms / 1000 / 60 / 60) / workDayHours;
    return `${hours.toFixed(2)} wd`;
}

export function formatDurationAsHours(ms: number): string {
    const hours = Math.floor(ms / 1000 / 60 / 60);
    const minutes = Math.floor(ms / 1000 / 60) % 60;

    if (hours === 0) {
        return minutes + "m";
    }

    return hours + "h" + pad2(minutes) + "m";
}

export function formatDuration(ms: number, unitLimit = -1) {
    const seconds = Math.floor(ms / 1000) % 60;
    const minutes = Math.floor(ms / 1000 / 60) % 60;
    const hours = Math.floor(ms / 1000 / 60 / 60) % 24;
    const days = Math.floor(ms / 1000 / 60 / 60 / 24);

    if (ms < 1000) {
        return `${ms} ms`;
    }

    const str = [];
    if (days) {
        str.push(`${days} d`);
    }

    if (hours) {
        // str.push(`${hours} hours`);
        str.push(`${hours} h`);
    }

    if (minutes) {
        // str.push(`${minutes} minutes`);
        str.push(`${minutes} m`);
    }

    if (seconds) {
        // str.push(`${seconds} seconds`);
        str.push(`${seconds} s`);
    }

    if (unitLimit !== -1) {
        return str.slice(0, unitLimit).join(", ");
    }

    return str.join(", ");
}

export function getDurationMS(aIsoString: string, bIsoString: string) {
    return new Date(bIsoString).getTime() - new Date(aIsoString).getTime();
}

// function getLastNote(state: State, lastNote: TreeNote) {
//     while (lastNote.childIds.length > 0) {
//         lastNote = getNote(state, lastNote.childIds[lastNote.childIds.length - 1]);
//     }

//     return lastNote;
// }

export function getTimestamp(date: Date) {
    return date.toISOString();
}

// It's a bit better than calling new Date() directly, when I'm uncertain about the input.
export function parseDateSafe(timestamp: string): Date | null {
    const d = new Date(timestamp);

    if (!isValidDate(d)) {
        return null;
    }

    return d;
}

export function isValidDate(d: Date) {
    return d instanceof Date && !isNaN(d.getTime());
}

export const ONE_SECOND = 1000;
export const ONE_MINUTE = ONE_SECOND * 60;
export const ONE_HOUR = 60 * ONE_MINUTE;
export const ONE_DAY = 24 * ONE_HOUR;

export function parseLocaleDateString(str: string): Date | null {
    let segments;
    if (str.indexOf("/") !== -1) {
        segments = str.split("/");
    } else if (str.indexOf("-") !== -1) {
        segments = str.split("-");
    } else if (str.indexOf(".") !== -1) {
        segments = str.split(".");
    } else if (str.indexOf(" ") !== -1) {
        segments = str.split(".");
    } else {
        // don't support this separator
        return null;
    }

    if (segments.length !== 3) {
        return null;
    }

    const order = inferMmDdYyyyOrder();
    if (!order) {
        return null;
    }

    let day = -1;
    let month = -1;
    let year = -1;
    for (let i = 0; i < order.length; i++) {
        const nextSegmentType = order[i];
        switch (nextSegmentType) {
            case 0: { // parse day
                day = parseInt(segments[i])
            } break;
            case 1: { // parse month
                month = parseInt(segments[i])
            } break;
            case 2: { // parse year
                year = parseInt(segments[i])
            } break;
        }
    }

    if (day === -1 || month === -1 || year === -1) {
        return null;
    }

    if (isNaN(day) || isNaN(month) || isNaN(year)) {
        return null;
    }

    const date = new Date();
    date.setFullYear(year);
    date.setMonth(month - 1);
    date.setDate(day);
    floorDateLocalTime(date);

    return date;
}

let mmDdYyyyOrder: [number, number, number] | null = null;
function inferMmDdYyyyOrder(): [number, number, number] {
    if (mmDdYyyyOrder !== null ) return mmDdYyyyOrder;

    // try formatting a date with known date, month, year, see which order they end up, and infer order from that

    const order: [number, number, number] = [0, 1, 2];

    const date = new Date();
    date.setFullYear(2000); // 2000
    date.setMonth(11); // 12
    date.setDate(15); // 15

    const str = date.toLocaleDateString();

    const yearIdx = str.indexOf("2000");
    const monthIdx = str.indexOf("12");
    const dayIdx = str.indexOf("15");

    if (yearIdx === -1 || monthIdx === -1 || dayIdx === -1) {
        throw new Error("The date couldn't be constructed in a predictable manner");
    }

    const parts = [
        [dayIdx, 0],
        [monthIdx, 1],
        [yearIdx, 2],
    ];
    parts.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < parts.length; i++) {
        order[i] = parts[i][1];
    }

    mmDdYyyyOrder = order;
    return order;
}

export function getDatePlaceholder(dayStr = "dd", monthStr = "mm", yearStr = "yyyy") {
    const order = inferMmDdYyyyOrder();

    const sb = [];

    for (let i = 0; i < order.length; i++) {
        const nextSegmentType = order[i];
        switch (nextSegmentType) {
            case 0: { // parse day
                sb.push(dayStr);
            } break;
            case 1: { // parse month
                sb.push(monthStr);
            } break;
            case 2: { // parse year
                sb.push(yearStr);
            } break;
        }
    }

    return sb.join("/");
}


// attempt to infer a date, assuming the string might be like
// Jan 1st 2045
export function extractDateFromText(text: string): { date: number; monthIdx: number; year: number; } {
    let monthIdx = -1, date = -1, year = -1;
    const holidayDateLower = text.toLowerCase();
    for (let mIdx = 0; mIdx < MONTH_NAMES_ABBREVIATED.length; mIdx++) {
        const month = MONTH_NAMES_ABBREVIATED[mIdx];
        const idx = holidayDateLower.indexOf(month);
        if (idx !== -1) {
            monthIdx = mIdx;
            break;
        }
    }

    if (monthIdx !== -1) {
        // parse out the first number. we can assume it's a day
        for (let i = 0; i < holidayDateLower.length; i++) {
            if (year === -1 &&
                i + 3 < holidayDateLower.length &&
                isDigit(holidayDateLower[i + 0]) &&
                isDigit(holidayDateLower[i + 1]) &&
                isDigit(holidayDateLower[i + 2]) &&
                isDigit(holidayDateLower[i + 3])
            ) {
                year = parseInt(holidayDateLower.substring(i, i + 4));
                i += 3;
                continue;
            }

            if (date === -1 &&
                i + 1 < holidayDateLower.length &&
                isDigit(holidayDateLower[i + 0]) &&
                isDigit(holidayDateLower[i + 1])
            ) {
                date = parseInt(holidayDateLower.substring(i, i + 2));
                i += 1;
                continue;
            }

            if (date === -1 &&
                i < holidayDateLower.length &&
                isDigit(holidayDateLower[i + 0])
            ) {
                date = parseInt(holidayDateLower.substring(i, i + 1));
                continue;
            }
        }
    }

    return { date, monthIdx, year };
}

export const MONTH_NAMES_ABBREVIATED = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sept",
    "oct",
    "nov",
    "dec"
];

// yyyy-mm-dd
export function parseIsoDate(str: string): Date | null {
    const segments = str.split("-");

    const year = parseInt(segments[0]);
    const month = parseInt(segments[1]);
    const date = parseInt(segments[2]);

    if (isNaN(year) || isNaN(month) || isNaN(date)) {
        return null;
    }

    return new Date(year, month - 1, date);
}

export function formatIsoDate(date: Date): string {
    return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
}

