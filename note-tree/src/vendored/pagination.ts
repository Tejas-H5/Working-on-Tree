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
