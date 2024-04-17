export function formatDate(date: Date) {
    const dd = date.getDate();
    const mm = date.getMonth() + 1;
    const yyyy = date.getFullYear();
    const hours = date.getHours();
    const minutes = date.getMinutes();

    return `${pad2(dd)}/${pad2(mm)}/${yyyy} ${pad2(((hours - 1) % 12) + 1)}:${pad2(minutes)} ${
        hours < 12 ? "am" : "pm"
    }`;
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
export function parseYMDTDateTime(value: string) : [Date | null, ErrorString] {
    // Picking a date with the default calender (i.e type="datetime-local" or similar) is always a PAIN. 
    // Especially when you have a very specific thing you're trying to do.
    // I reckon I'll just stick to an input format like 
    // 06/04/2024 05:41 pm

    // Possibly over-lenient date time regex
    // "06/04/2024 05:41 pm".match(/(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)?/)

    const regex = /(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*(am|pm)?/;
    const matches = value.match(regex);
    if (!matches) {
        return [null, "Couldn't find a date"];
    }

    const [
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

export function floorDateLocalTime(date: Date) {
    date.setHours(0, 0, 0, 0);
}

export function addDays(date: Date, days: number) {
    date.setDate(date.getDate() + days)
}

// 1 work day is actually 7.5 hours.
export function formatDurationInWorkdays(ms: number): string {
    const workDayHours = 7.5;
    const hours = (ms / 1000 / 60 / 60) / workDayHours;
    return `${hours.toFixed(2)} wd`;
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
        str.push(`${days} days`);
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
