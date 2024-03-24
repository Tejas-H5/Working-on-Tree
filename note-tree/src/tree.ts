
// This tree is supposed to be JSON-serializable. 
// T is an index into the TreeStore which stores the actual data, rather than an in-memory reference

import { assert } from "./htmlf";

// to the node object.
export type TreeNode<T> = {
    id: string;
    parentId: string | null;
    childIds: string[];
    data: T;
} 

// Surely this won't collide with a user's id, right? 
export const ROOT_KEY = "[Root Key]";

export type TreeStore<T> = {
    nodes: { [key: string ] : TreeNode<T> };
    rootId: string;
}


export function newTreeStore<T>(rootNoteData: T): TreeStore<T> {
    const rootNode : TreeNode<T> = {
        id: ROOT_KEY,
        parentId: null,
        childIds: [],
        data: rootNoteData
    };

    return {
        nodes: { [ROOT_KEY]: rootNode },
        rootId: ROOT_KEY,
    };
}

export function forEachNode(tree: TreeStore<unknown>, fn: (id: string) => void) {
    for (const id in tree.nodes) {
        fn(id);
    }
}

export function forEachParent<T>(tree: TreeStore<T>, node: TreeNode<T>, fn: (node: TreeNode<T>) => boolean) {
    while (node.parentId) {
        if (fn(node)) {
            break;
        }
        node = getNode(tree, node.parentId);
    }
}

export function hasNode(tree: TreeStore<unknown>, id: string): boolean {
    return !!tree.nodes[id];
}

export function getNode<T>(tree: TreeStore<T>, id: string): TreeNode<T> {
    const data = tree.nodes[id];
    if (!data) {
        throw new Error("Node not found: " + id);
    }

    return data;
}

export function getSize(tree: TreeStore<unknown>) {
    let sum = 0;
    for (const _ in tree.nodes)  {
        sum += 1;
    }

    // don't count the root node
    return sum - 1;
}

export function newTreeNode<T>(data: T, dataId: string) : TreeNode<T> {
    if (dataId === ROOT_KEY) {
        throw new Error("The following key is reserved for the root node, you can't use it as your id or you'll overwrite it: " + dataId);
    }

    const node: TreeNode<T> = {
        id: dataId,
        parentId: null,
        childIds: [],
        data
    };

    return node;
}

export function remove(tree: TreeStore<unknown>, node: TreeNode<unknown>) {
    if (!node.parentId) {
        return;
    }

    // remove node from it's parent
    const parent = getNode(tree, node.parentId);
    const idx = parent.childIds.indexOf(node.id);
    assert(idx !== -1, "Possible data corruption");
    parent.childIds.splice(idx, 1);

    // clear out the parent
    node.parentId = null;

    // remove it from the tree
    delete tree.nodes[node.id];
}

export function addUnder(tree: TreeStore<unknown>, parent: TreeNode<unknown>, nodeToAdd: TreeNode<unknown>) {
    insertAt(tree, parent, nodeToAdd, parent.childIds.length);
}

export function addBefore(tree: TreeStore<unknown>, child: TreeNode<unknown>, nodeToAdd: TreeNode<unknown>) {
    if (!child.parentId) {
        console.warn("Invalid to addAfter a node without have a parent")
        return;
    }

    const parent = getNode(tree, child.parentId);
    const idx = parent.childIds.indexOf(child.id);
    insertAt(tree, parent, nodeToAdd, idx);
}

export function addAfter(tree: TreeStore<unknown>, child: TreeNode<unknown>, nodeToAdd: TreeNode<unknown>) {
    if (!child.parentId) {
        console.warn("Invalid to addAfter a node without have a parent")
        return;
    }

    const parent = getNode(tree, child.parentId);
    const idx = parent.childIds.indexOf(child.id);
    insertAt(tree, parent, nodeToAdd, idx + 1);
}

export function insertAt(tree: TreeStore<unknown>, parent: TreeNode<unknown>, nodeToAdd: TreeNode<unknown>, idx: number) {
    remove(tree, nodeToAdd);

    tree.nodes[nodeToAdd.id] = nodeToAdd;

    parent.childIds.splice(idx, 0, nodeToAdd.id);

    nodeToAdd.parentId = parent.id;
}