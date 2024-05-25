import { Renderable, div, newComponent, setText, setVisible } from "src/utils/dom-utils";
import { Pagination, getCurrentEnd, getMaxPages, getPage, getStart, idxToPage, setPage, setTotalCount } from "src/utils/pagination";
import { makeButton } from "./button";

type PaginationControlArgs = {
    totalCount: number;
    pagination: Pagination;
    rerender(): void;
};


export function PaginationControl(): Renderable<PaginationControlArgs> {
    const leftButton = makeButton("<");
    const leftLeftButton = makeButton("<<");
    const rightButton = makeButton(">");
    const rightRightButton = makeButton(">>");
    const pageReadout = div({ style: "" });

    const root = div({ style: "border-top: 1px solid var(--fg-color);", class: "row align-items-center" }, [
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

    const component = newComponent<PaginationControlArgs>(root, () => {
        const { pagination, totalCount } = component.args;

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


    leftButton.el.addEventListener("click", () => {
        const { pagination, rerender } = component.args;
        setPage(pagination, getPage(pagination) - 1);
        rerender();
    });

    leftLeftButton.el.addEventListener("click", () => {
        const { pagination, rerender } = component.args;
        pagination.start = 0;
        rerender();
    });

    rightRightButton.el.addEventListener("click", () => {
        const { pagination, rerender } = component.args;
        pagination.start = idxToPage(pagination, pagination.totalCount) * pagination.pageSize;
        rerender();
    });


    rightButton.el.addEventListener("click", () => {
        const { pagination, rerender } = component.args;
        setPage(pagination, getPage(pagination) + 1);
        rerender();
    });

    return component;
}
