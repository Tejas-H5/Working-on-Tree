import { RenderGroup, State, div, newComponent, setText, setVisible } from "src/utils/dom-utils";
import { Pagination, getCurrentEnd, getMaxPages, getPage, getStart, idxToPage, setPage, setTotalCount } from "src/utils/pagination";
import { Button } from "./button";

type PaginationControlArgs = {
    totalCount: number;
    pagination: Pagination;
    rerender(): void;
};

export function PaginationControl(rg: RenderGroup, s: State<PaginationControlArgs>) {
    function previousPage() {
        const { pagination, rerender } = s.args;
        setPage(pagination, getPage(pagination) - 1);
        rerender();
    }

    function firstPage() {
        const { pagination, rerender } = s.args;
        pagination.start = 0;
        rerender();
    }

    function nextPage() {
        const { pagination, rerender } = s.args;
        setPage(pagination, getPage(pagination) + 1);
        rerender();
    }

    function lastPage() {
        const { pagination, rerender } = s.args;
        pagination.start = idxToPage(pagination, pagination.totalCount) * pagination.pageSize;
        rerender();
    }

    const leftButton = newComponent(Button)
    leftButton.render({ label: "<", onClick: previousPage });
    const leftLeftButton = newComponent(Button);
    leftLeftButton.render({ label: "<<", onClick: firstPage});
    const rightButton = newComponent(Button);
    rightButton.render({ label: ">", onClick: nextPage });
    const rightRightButton = newComponent(Button);
    rightRightButton.render({ label: ">>", onClick: lastPage });

    const pageReadout = div({ style: "" });



    let page = 0, start = 0, end = 0, maxPages = 0;
    rg.preRenderFn(function renderPaginationControl() {
        const { pagination, totalCount } = s.args;

        setTotalCount(pagination, totalCount);
        const page = getPage(pagination);
        const start = getStart(pagination) + 1;
        const end = getCurrentEnd(pagination);
        setText(pageReadout, "Page " + (page + 1) + " (" + start + " - " + end + " / " + pagination.totalCount + ")");

        setVisible(leftButton, page !== 0);
        setVisible(leftLeftButton, page !== 0);
        setVisible(rightButton, page !== getMaxPages(pagination));
        setVisible(rightRightButton, page !== getMaxPages(pagination));
    });

    return div({ style: "border-top: 1px solid var(--fg-color);", class: "row align-items-center" }, [
        pageReadout,
        div({ class: "flex-1" }),
        div({ style: "width: 100px", class: "row" }, [
            leftLeftButton,
            leftButton,
        ]),
        div({ style: "width: 100px", class: "row justify-content-right" }, [
            rightButton,
            rightRightButton,
        ]),
    ])
}
