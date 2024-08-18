import { RenderGroup, div, getState, newComponent } from "src/utils/dom-utils";
import { Pagination, getCurrentEnd, getMaxPages, getPage, getStart, idxToPage, setPage, setTotalCount } from "src/utils/pagination";
import { Button } from "./button";

export function PaginationControl(rg: RenderGroup<{
    totalCount: number;
    pagination: Pagination;
    rerender(): void;
}>) {
    function previousPage() {
        const { pagination, rerender } = getState(rg);
        setPage(pagination, getPage(pagination) - 1);
        rerender();
    }

    function firstPage() {
        const { pagination, rerender } = getState(rg);
        pagination.start = 0;
        rerender();
    }

    function nextPage() {
        const { pagination, rerender } = getState(rg);
        setPage(pagination, getPage(pagination) + 1);
        rerender();
    }

    function lastPage() {
        const { pagination, rerender } = getState(rg);
        pagination.start = idxToPage(pagination, pagination.totalCount) * pagination.pageSize;
        rerender();
    }

    let page = 0, start = 0, end = 0, maxPages = 0;
    rg.renderFn(function renderPaginationControl(s) {
        const { pagination, totalCount } = s;

        setTotalCount(pagination, totalCount);

        page = getPage(pagination);
        start = getStart(pagination) + 1;
        end = getCurrentEnd(pagination);
        maxPages = getMaxPages(pagination);
    });

    return div({ style: "border-top: 1px solid var(--fg-color);", class: "row align-items-center" }, [
        div({ style: "" }, [
            rg.text((s) => "Page " + (page + 1) + " (" + start + " - " + end + " / " + s.pagination.totalCount + ")"),
        ]),
        div({ class: "flex-1" }),
        div({ style: "width: 100px", class: "row" }, [
            rg.if(() => page !== 0,
                rg => newComponent(Button, { label: "<<", onClick: firstPage }),
            ),
            rg.if(() => page !== 0,
                rg => newComponent(Button, { label: "<", onClick: previousPage })
            )
        ]),
        div({ style: "width: 100px", class: "row justify-content-right" }, [
            rg.if(() => page !== maxPages,
                rg => newComponent(Button, { label: ">", onClick: nextPage })
            ),
            rg.if(() => page !== maxPages,
                rg => newComponent(Button, { label: ">>", onClick: lastPage })
            ),
        ]),
    ])
}
