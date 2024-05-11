import { Renderable, div, newComponent, setText, setVisible } from "./dom-utils";
import { makeButton } from "./generic-components";

export type Pagination = {
    start: number;
    pageSize: number;
    totalCount: number;
}

export function setTotalCount(pagination: Pagination, total: number) {
    pagination.totalCount = total;
    if (pagination.start >= total) {
        pagination.start = getMaxPages(pagination) * pagination.pageSize;
    }
}

export function getPage(pagination: Pagination) {
    return idxToPage(pagination, getStart(pagination));
}

export function getStart(pagination: Pagination) {
    return pagination.start;
}

export function getCurrentEnd(pagination: Pagination) {
    return Math.min(pagination.totalCount, getStart(pagination) + pagination.pageSize);
}

export function setPage(pagination: Pagination, page: number) {
    pagination.start = Math.max(0, Math.min(pagination.totalCount, page * pagination.pageSize));
}

export function idxToPage(pagination: Pagination, idx: number) {
    return Math.floor(idx / pagination.pageSize);
}

export function getMaxPages(pagination: Pagination) {
    return Math.max(0, idxToPage(pagination, pagination.totalCount - 1));
}

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
        div({ style: "width: 100px", class: "row" }, [
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
