// import { RenderGroup, cn, div } from "src/utils/dom-utils";
// import { Pagination, getCurrentEnd, getMaxPages, getPage, getStart, idxToPage, setPage, setTotalCount } from "src/utils/pagination";
// import { Button } from "./button";
//
// export function PaginationControl(rg: RenderGroup<{
//     totalCount: number;
//     pagination: Pagination;
//     rerender(): void;
// }>) {
//     function previousPage() {
//         const { pagination, rerender } = rg.s;
//         setPage(pagination, getPage(pagination) - 1);
//         rerender();
//     }
//
//     function firstPage() {
//         const { pagination, rerender } = rg.s;
//         pagination.start = 0;
//         rerender();
//     }
//
//     function nextPage() {
//         const { pagination, rerender } = rg.s;
//         setPage(pagination, getPage(pagination) + 1);
//         rerender();
//     }
//
//     function lastPage() {
//         const { pagination, rerender } = rg.s;
//         pagination.start = idxToPage(pagination, pagination.totalCount) * pagination.pageSize;
//         rerender();
//     }
//
//     let page = 0, start = 0, end = 0, maxPages = 0;
//     rg.preRenderFn(function renderPaginationControl(s) {
//         const { pagination, totalCount } = s;
//
//         setTotalCount(pagination, totalCount);
//
//         page = getPage(pagination);
//         start = getStart(pagination) + 1;
//         end = getCurrentEnd(pagination);
//         maxPages = getMaxPages(pagination);
//     });
//
//     return div({ style: `border-top: 1px solid currentColor;`, class: [cn.row, cn.alignItemsCenter] }, [
//         div({ style: "" }, [
//             rg.text((s) => `Page ${page + 1} (${start}) - ${end} / ${s.pagination.totalCount})`)
//         ]),
//         div({ class: [cn.flex1] }),
//         div({ style: "width: 100px", class: [cn.row] }, [
//             rg.if(() => page !== 0, rg => 
//                 rg.c(Button, c => c.render({ label: "<<", onClick: firstPage })),
//             ),
//             rg.if(() => page !== 0, rg => 
//                 rg.c(Button, c => c.render({ label: "<", onClick: previousPage }))
//             )
//         ]),
//         div({ style: "width: 100px", class: [cn.row, cn.justifyContentRight] }, [
//             rg.if(() => page !== maxPages, rg => 
//                 rg.c(Button, c => c.render({ label: ">", onClick: nextPage }))
//             ),
//             rg.if(() => page !== maxPages, rg => 
//                 rg.c(Button, c => c.render({ label: ">>", onClick: lastPage }))
//             ),
//         ]),
//     ]);
// }
