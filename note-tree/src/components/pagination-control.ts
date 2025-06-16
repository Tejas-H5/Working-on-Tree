import { imBeginDiv, imEnd, imEndIf, imIf, imInit, setAttr, setClass, setInnerText, setStyle } from "src/utils/im-dom-utils";
import { Pagination, getCurrentEnd, getMaxPages, getPage, getStart, idxToPage, setPage } from "src/utils/pagination";
import { cn } from "src/utils/cssb";
import { imButton } from "./button";


function previousPage(pagination: Pagination) {
    setPage(pagination, getPage(pagination) - 1);
}

function firstPage(pagination: Pagination) {
    pagination.start = 0;
}

function nextPage(pagination: Pagination) {
    setPage(pagination, getPage(pagination) + 1);
}

function lastPage(pagination: Pagination) {
    pagination.start = idxToPage(pagination, pagination.totalCount) * pagination.pageSize;
}

export function imPaginationControl(pagination: Pagination) {
    const page = getPage(pagination);
    const start = getStart(pagination) + 1;
    const end = getCurrentEnd(pagination);
    const maxPages = getMaxPages(pagination);

    imBeginDiv(); {
        if (imInit()) {
            setAttr("style", `border-top: 1px solid currentColor;`);
            setClass(cn.row);
            setClass(cn.alignItemsCenter);
        }

        imBeginDiv(); {
            setInnerText(`Page ${page + 1} (${start}) - ${end} / ${pagination.totalCount})`);
        } imEnd();
        imBeginDiv(); {
            if (imInit()) {
                setClass(cn.flex1);
            }
        } imEnd();

        imBeginDiv(); {
            if (imInit()) {
                setStyle("width", "100px");
                setClass(cn.row);
            }

            if (imIf() && page !== 0) {
                if (imButton("<<")) {
                    firstPage(pagination);
                }
                if (imButton("<")) {
                    previousPage(pagination);
                }
            } imEndIf();
        } imEnd();
        imBeginDiv(); {
            if (imInit()) {
                setStyle("width", "100px");
                setClass(cn.row);
            }

            if (imIf() && page !== maxPages) {
                if (imButton(">")) {
                    nextPage(pagination);
                }
                if (imButton(">>")) {
                    lastPage(pagination);
                }
            } imEndIf();
        } imEnd();
    } imEnd();
}
