import { imTextAreaBegin, imTextAreaEnd } from "./components/editable-text-area";
import { assert } from "./utils/assert";
import {
    addMinutes,
    clampDate,
    cloneDate,
    dateSetLocalTime,
    formatTimeForInput,
    parseDurationInput,
    parseTimeInput,
    roundToNearestMinutes
} from "./utils/datetime";
import { setInputValue } from "./utils/dom-utils";
import { CACHE_IDX, ImCache, imGet, imSet } from "./utils/im-core";
import { EV_CHANGE, EV_FOCUS, EV_INPUT, EV_KEYDOWN, imOn } from "./utils/im-dom";

type TimeInputStateEditEvent = {
    timeInput?: Date | null;
    durationInput?: number;
};

type TimeInputState = {
    text: string;
    valueBeforeEdit: Date | null,
    value: Date | null;
    // actually never meant to be null.
    textArea: HTMLTextAreaElement | null;
    edit: TimeInputStateEditEvent | null;
}

function newTimeInputState(): TimeInputState {
    return {
        text: "", // possibly not needed at all?
        valueBeforeEdit: null,
        value: null,
        textArea: null,
        edit: null,
    };
}

export function imEditableTime(
    c: ImCache,
    currentValue: Date | null,
    lowerBound: Date | null = null,
    upperBound: Date | null = null,
): TimeInputState {
    let textArea: HTMLTextAreaElement | undefined;

    if (upperBound && lowerBound) {
        assert(lowerBound.getTime() < upperBound.getTime());
    }

    let s = imGet(c, newTimeInputState);
    if (!s) s = imSet(c, newTimeInputState());
    s.textArea = null;
    s.edit = null;

    const idx = c[CACHE_IDX];

    [, textArea] = imTextAreaBegin(c, {
        value: s.text,
        placeholder: "Time",
    }); {
        s.textArea = textArea;

        const focus = imOn(c, EV_FOCUS);
        const input = imOn(c, EV_INPUT);
        const change = imOn(c, EV_CHANGE);
        const keyDown = imOn(c, EV_KEYDOWN);

        if (
            // Refocus -> synced
            focus || 
            // (
            //   First render  -> synced 
            //   Edited, it was applied  -> internal updated, text not synced
            //   Edited, it was not applied -> synced with the outside
            // ) 
            (s.value === null || s.value.getTime() !== currentValue?.getTime())
        ) {
            let setType = SET_INTERNAL_AND_TEXT;
            if (document.activeElement === textArea && !focus) {
                setType = SET_INTERNAL_ONLY;
            }

            setInnerValue(s, currentValue, lowerBound, upperBound, setType);
            if (setType === SET_INTERNAL_AND_TEXT) {
                setInputValue(textArea, s.text);
                textArea.select();
            }
        }

        if (input || change || keyDown) {
            if (input || change) {
                // don't edit the text till we're done
                s.text = textArea.value.trim();
                s.edit = parseTimeEditEvent(s.text, currentValue, upperBound);
            } else if (keyDown) {
                const up = keyDown.key === "ArrowUp";
                const down = keyDown.key === "ArrowDown";
                const altHeld = keyDown.altKey;

                if (up || down) {
                    let timeIncrement = 5;
                    if (altHeld) {
                        timeIncrement = 30;
                    }

                    let editedDate = new Date(currentValue ?? new Date());
                    if (up) {
                        roundToNearestMinutes(editedDate, timeIncrement);
                        addMinutes(editedDate, timeIncrement);
                    } else {
                        roundToNearestMinutes(editedDate, timeIncrement);
                        addMinutes(editedDate, -timeIncrement);
                    }

                    editedDate = clampDate(editedDate, lowerBound, upperBound);

                    setInnerValue(s, editedDate, lowerBound, upperBound, SET_INTERNAL_AND_TEXT);
                    s.edit = { timeInput: cloneDate(s.value) }
                }
            }
        }
    } imTextAreaEnd(c);

    assert(c[CACHE_IDX] === idx);

    return s;
}

const SET_INTERNAL_AND_TEXT = false;
const SET_INTERNAL_ONLY = true;

function setInnerValue(
    s: TimeInputState,
    editedDate: Date | null,
    lowerBound: Date | null,
    upperBound: Date | null,
    type: typeof SET_INTERNAL_ONLY | typeof SET_INTERNAL_AND_TEXT
) {
    s.value = editedDate ? clampDate(editedDate, lowerBound, upperBound) : null;
    if (type === SET_INTERNAL_AND_TEXT) {
        s.text = formatTimeForInput(s.value);
    }
}

export function parseTimeEditEvent(
    text: string,
    currentDate: Date | null,
    nextDate: Date | null,
): TimeInputStateEditEvent | null {
    if (!currentDate) currentDate = new Date();
    if (!nextDate) nextDate = new Date();

    const [time, err] = parseTimeInput(text, currentDate);
    if (!err) {
        const result = new Date(currentDate);
        dateSetLocalTime(result, time);
        return { timeInput: result };
    } 

    // Typeing 1h for an activity would mean we wanted that activity to have taken 1 hr.
    const [duration, err2] = parseDurationInput(text);
    if (!err2) {
        return { durationInput: duration };
    }

    return null;
}

