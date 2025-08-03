import { cssVarsApp } from "./app-styling";
import { imBegin, ROW, imFlex, ROW_REVERSE, imRelative, imSize, PX, NA, imAbsolute, EM, imBg, imOpacity, imInitClasses, CH } from "./components/core/layout";
import { cn } from "./components/core/stylesheets";
import { imBeginTextArea, doExtraTextAreaInputHandling, imEndTextArea } from "./components/editable-text-area";
import { GlobalContext } from "./global-context";
import { imListRowCellStyle } from "./list-row";
import { NavigableListState, imBeginNavListRow, imEndNavListRow } from "./navigable-list";
import { NoteTreeViewState } from "./note-tree-view";
import { TreeNote, getNote, state, STATUS_IN_PROGRESS, idIsRoot, idIsNil, getNumSiblings, noteStatusToString, isNoteCollapsed, setNoteText } from "./state";
import { setClass, imFor, imNextListRoot, imIf, imIsFirstishRender, setStyle, imEnd, imEndIf, imEndFor, imMemo, setText, imBeginSpan, imOn, imElse } from "./utils/im-dom-utils";

export function imNoteTreeRow(
    ctx: GlobalContext,
    list: NavigableListState | null,
    s: NoteTreeViewState,
    note: TreeNote,
    viewFocused: boolean,
    idx = -1,
    itemSelected = false) {
    s.numVisible++;

    let numInProgress = 0;
    let numDone = 0;
    for (const id of note.childIds) {
        const note = getNote(state, id);
        if (note.data._status === STATUS_IN_PROGRESS) {
            numInProgress++;
        } else {
            numDone++;
        }
    }

    const root = imBeginNavListRow(list); {
        imBegin(ROW); imFlex(); {
            setClass(cn.preWrap, itemSelected);

            // The tree visuals
            imBegin(ROW_REVERSE); {
                imFor();

                const noteIsParent = s.noteParentNotes.includes(note) || idIsRoot(note.id);

                let it = note;
                let foundLineInPath = false;
                let depth = -1;

                while (!idIsNil(it.parentId)) {
                    imNextListRoot();

                    const itPrev = it;
                    const itPrevNumSiblings = getNumSiblings(state, itPrev);
                    it = getNote(state, it.parentId);
                    depth++;

                    // |---->| indent
                    // [  x  ]Vertical line should line up with the note status above it:
                    //    |
                    //    |<-| bullet start
                    //    |
                    //    +-- [ x ] >> blah blah blah
                    // const isLineInPath = inPath && prev === note;
                    const itIsParent = s.noteParentNotes.includes(it) || idIsRoot(it.id);

                    const isLineInPath: boolean = !foundLineInPath &&
                        idx <= s.listPos.idx &&
                        itIsParent;

                    foundLineInPath ||= isLineInPath;

                    const hasHLine = itPrev.id === note.id;
                    const indent = 30;
                    const bulletStart = 5;

                    const smallThicnkess = 1;
                    const largeThicnkess = 4;
                    const isLast = itPrev.idxInParentList === itPrevNumSiblings - 1;

                    let pathGoesRight = (noteIsParent || it.id === note.id);

                    // the tree visuals. It was a lot easier to do these here than in my last framework
                    {
                        imBegin(); imRelative(); imSize(indent, PX, 0, NA); {
                            // horizontal line xD
                            if (imIf() && hasHLine) {
                                imBegin();
                                imAbsolute(0, NA, 0, PX, 1, EM, 0, NA);
                                const isThick = isLineInPath && pathGoesRight;
                                imSize(
                                    bulletStart, PX,
                                    isThick ? largeThicnkess : smallThicnkess, PX
                                );
                                imBg(cssVarsApp.fgColor); {
                                    if (imIsFirstishRender()) {
                                        setStyle("transform", "translate(0, -100%)");
                                    }
                                } imEnd();
                            } imEndIf();

                            const canDrawVerticalLine = !isLast || note === itPrev;

                            if (imIf() && canDrawVerticalLine) {
                                let midpointLen = 1;
                                let midpointUnits = EM;

                                // Vertical line part 1. xd. We need a better API
                                imBegin();
                                imAbsolute(
                                    0, NA, bulletStart, PX,
                                    0, PX, 0, isLast ? NA : PX
                                );
                                imSize(
                                    isLineInPath ? largeThicnkess : smallThicnkess, PX,
                                    midpointLen, midpointUnits
                                );
                                imBg(cssVarsApp.fgColor); {
                                } imEnd();

                                // Vertical line part 2.
                                imBegin();
                                imAbsolute(
                                    0, NA, bulletStart, PX,
                                    midpointLen, midpointUnits, 0, isLast ? NA : PX
                                );
                                const isThick = isLineInPath && !pathGoesRight;
                                imSize(
                                    isThick ? largeThicnkess : smallThicnkess, PX,
                                    0, NA
                                );
                                imOpacity(isLast ? 0 : 1);
                                imBg(cssVarsApp.fgColor); {
                                } imEnd();
                            } imEndIf();
                        } imEnd();
                    }
                }
                imEndFor();
            } imEnd();

            imBegin(ROW); imFlex(); imListRowCellStyle(); {
                if (imMemo(note.data._status)) {
                    setStyle("color", note.data._status === STATUS_IN_PROGRESS ? "" : cssVarsApp.unfocusTextColor);
                }

                imBegin(ROW); imFlex(); {
                    if (imMemo(itemSelected)) {
                        setClass(cn.preWrap, itemSelected);
                        setClass(cn.pre, !itemSelected);
                        setClass(cn.noWrap, !itemSelected);
                        setClass(cn.overflowHidden, !itemSelected);
                    }

                    imBegin(ROW); {
                        imInitClasses(cn.noWrap);
                        imBegin(); setText(noteStatusToString(note.data._status)); imEnd();
                        if (imIf() && (numInProgress + numDone) > 0) {
                            imBegin(); imSize(0.5, CH, 0, NA); imEnd();
                            imBeginSpan(); setText(`(${numDone}/${numInProgress + numDone})`); imEnd();
                        } imEndIf();
                        imBegin(); imSize(0.5, CH, 0, NA); imEnd();
                    } imEnd();

                    const isEditing = viewFocused && itemSelected && state._isEditingFocusedNote;
                    const isEditingChanged = imMemo(isEditing);

                    if (imIf() && isEditing) {
                        const [, textArea] = imBeginTextArea({
                            value: note.data.text,
                        }); {
                            const input = imOn("input");
                            const change = imOn("change");

                            if (input || change) {
                                let status = s.note.data._status;
                                let collapseStatus = isNoteCollapsed(s.note);

                                setNoteText(state, s.note, textArea.root.value);

                                state._notesMutationCounter++;
                                ctx.handled = true;
                                if (status !== s.note.data._status ||
                                    collapseStatus !== isNoteCollapsed(s.note)) {
                                    s.invalidateNote = true;
                                }
                            }

                            const keyDown = imOn("keydown");
                            if (keyDown) {
                                ctx.handled = doExtraTextAreaInputHandling(keyDown, textArea.root, {});
                            }

                            if (isEditingChanged) {
                                textArea.root.selectionStart = textArea.root.value.length;
                                textArea.root.selectionEnd = textArea.root.value.length;
                            }

                            ctx.textAreaToFocus = textArea;
                        } imEndTextArea();
                    } else {
                        imElse();

                        imBeginSpan(); {
                            imBeginSpan(); {
                                if (imMemo(note.data.text)) {
                                    let text = note.data.text;
                                    if (text.length > 150) {
                                        text = `[${text.length}ch] - ${text}`;
                                    }

                                    setText(text);
                                }
                            } imEnd();
                        } imEnd();
                    } imEndIf();
                } imEnd();
            } imEnd();
        } imEnd();
    } imEndNavListRow();

    return root;
}

