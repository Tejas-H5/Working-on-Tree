import { imBeginTextArea, imEndTextArea } from "./components/editable-text-area";
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
import {
    imOn,
    imState,
    setInputValue,
    UIRoot
} from "./utils/im-dom-utils";

type TimeInputStateEditEvent = {
    newValue: Date | null;
};

type TimeInputState = {
    text: string;
    valueBeforeEdit: Date | null,
    value: Date | null;
    // actually never meant to be null.
    textArea: UIRoot<HTMLTextAreaElement> | null;
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
    currentValue: Date | null,
    lowerBound: Date | null = null,
    upperBound: Date | null = null,
): TimeInputState {
    let textArea: UIRoot<HTMLTextAreaElement> | undefined;

    if (upperBound && lowerBound) {
        assert(lowerBound.getTime() < upperBound.getTime());
    }

    const s = imState(newTimeInputState);
    s.textArea = null;
    s.edit = null;

    [, textArea] = imBeginTextArea({
        value: s.text,
        placeholder: "Time",
    }); {
        s.textArea = textArea;

        const focus = imOn("focus");
        const input = imOn("input");
        const change = imOn("change");
        const keyDown = imOn("keydown");

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
            if (document.activeElement === textArea.root && !focus) {
                setType = SET_INTERNAL_ONLY;
            }

            setValue(s, currentValue, lowerBound, upperBound, setType);
            if (setType === SET_INTERNAL_AND_TEXT) {
                setInputValue(textArea.root, s.text);
                textArea.root.select();
            }
        }

        if (input || change || keyDown) {
            if (input || change) {
                // don't edit the text till we're done
                s.text = textArea.root.value.trim();
                const parsed = parseActivityTime(s.text, currentValue, upperBound);
                setValue(s, parsed, lowerBound, upperBound, SET_INTERNAL_ONLY);
                s.edit = { newValue: cloneDate(s.value) };
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

                    setValue(s, editedDate, lowerBound, upperBound, SET_INTERNAL_AND_TEXT);
                    s.edit = { newValue: cloneDate(s.value) }
                }
            }
        }
    } imEndTextArea();

    return s;
}

const SET_INTERNAL_AND_TEXT = false;
const SET_INTERNAL_ONLY = true;

function setValue(
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

export function parseActivityTime(
    text: string,
    currentDate: Date | null,
    nextDate: Date | null,
): Date | null {
    if (!currentDate) currentDate = new Date();
    if (!nextDate) nextDate = new Date();

    const [time, err] = parseTimeInput(text, currentDate);
    if (!err) {
        const result = new Date(currentDate);
        dateSetLocalTime(result, time);
        return result;
    } 

    // Typeing 1h for an activity would mean we wanted that activity to have taken 1 hr.
    const [duration, err2] = parseDurationInput(text);
    if (!err2) {
        const result = new Date(nextDate);
        result.setTime(result.getTime() - duration);
        return result;
    }

    return null;
}

