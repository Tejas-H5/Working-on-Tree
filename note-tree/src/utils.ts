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

// export function countNewlines(value: string): number {
//     let newLines = 0;
//     for (const c of value) {
//         if (c === '\n') {
//             newLines ++;
//         }
//     }

//     return newLines;
// }