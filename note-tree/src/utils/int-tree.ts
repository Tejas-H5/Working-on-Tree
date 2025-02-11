// This tree is supposed to be JSON-serializable. 
// T is an index into the TreeStore which stores the actual data, rather than an in-memory reference

// to the node object.
// NOTE: in hindsight, this is a bit of a blunder caused by mindlessness. There's no reason to use uuids here - we should have just used
// an index into an array. I could change it but I would need to create migration scripts.
export type TreeNode<T> = {
    // NOTE: id=0 will always be _the_ root node. There may still be other root nodes, however...
    id: number;
    parentId: number;
    idxInParentList: number; // NOTE: this id is transient, and can always change as nodes are added/removed.
    childIds: number[];
    data: T;
};

export type TreeStore<T> = {
    nodes: (TreeNode<T> | null)[];
}

export function forEachNode<T>(tree: TreeStore<T>, fn: (n: TreeNode<T>) => void) {
    for (let i = 0; i < tree.nodes.length; i++) {
        const n = tree.nodes[i];
        if (n !== null) {
            fn(n);
        }
    }
}

export function newTreeStore<T>(rootNoteData: T): TreeStore<T> {
    const rootNode : TreeNode<T> = {
        id: 0,
        parentId: -1,
        idxInParentList: -1,
        childIds: [],
        data: rootNoteData
    };

    return {
        nodes: [rootNode]
    };
}

export function hasNode(tree: TreeStore<unknown>, idx: number): idx is number {
    if (idx === -1) {
        return false;
    }

    return !!tree.nodes[idx];
}

export function getNode<T>(tree: TreeStore<T>, idx: number): TreeNode<T> {
    const data = tree.nodes[idx];
    if (!data) {
        if (data === null) {
            throw new Error("Found tombstone instead of a node at " + idx);
        }

        throw new Error("Node not found: " + idx);
    }

    return data;
}

// You can be sure that a node's parentIdx and idxInParent aren't null if this isn't undefined
export function getParent(tree: TreeStore<unknown>, node: TreeNode<unknown>): TreeNode<unknown> | undefined {
    const parentIdx = node.parentId;
    const idxInParent = node.idxInParentList;
    if (parentIdx === -1) {
        return undefined;
    }

    const parent = tree.nodes[parentIdx];
    if (parent === null) {
        return undefined;
    }

    if (idxInParent === -1) {
        throw new Error("idxInParent can't be null if parentIdx wasn't -1");
    }

    if (parent.childIds[idxInParent] !== node.id) {
        throw new Error("Node's idxInParent was inconsistent with the parent's list");
    }

    return parent;
}

export function getSizeExcludingRoot(tree: TreeStore<unknown>) {
    // don't include the root note, therefore -1
    return tree.nodes.length - 1;
}

export function newTreeNode<T>(data: T) : TreeNode<T> {
    const node: TreeNode<T> = {
        id: -1,
        parentId: -1,
        idxInParentList: -1,
        childIds: [],
        data
    };

    return node;
}

// removes a node from it's parent, but keeps it in the tree store.
// Useful for moving a node.
export function detatch(tree: TreeStore<unknown>, node: TreeNode<unknown>) {
    const parent = getParent(tree, node);
    if (!parent) {
        return;
    }

    const idxInParentList = node.idxInParentList;

    // remove node from it's parent
    parent.childIds.splice(idxInParentList, 1);
    reindexChildren(tree, parent, idxInParentList);

    // clear out the parent
    node.parentId = -1;
    node.idxInParentList = -1;

}

export function remove(tree: TreeStore<unknown>, node: TreeNode<unknown>) {
    if (node.id === -1) {
        return;
    }

    detatch(tree, node);

    // remove it from the tree - add a tombstone here. 
    // All positions must remain intact
    tree.nodes[node.id] = null;

    // A node's index only makes sense only if it's actually in the tree.
    node.id = -1;
}

// children must be re-indexed whenever they are moved around in their array
function reindexChildren(tree: TreeStore<unknown>, note: TreeNode<unknown>, from: number) {
    for (let i = from; i < note.childIds.length; i++) {
        const child = getNode(tree, note.childIds[i]);
        child.idxInParentList = i;
    }
}

/**
 * Adds a node to the tree for the first time, or detatches it if it already exists.
 * You can be sure it will have an idx after calling this.
 */
export function addAsRoot(tree: TreeStore<unknown>, node: TreeNode<unknown>) {
    if (node.id === -1) {
        const idx = getNextAvailableIndex(tree);
        node.id = idx;
        tree.nodes[idx] = node;
        return;
    }

    detatch(tree, node);
}

function getNextAvailableIndex(tree: TreeStore<unknown>): number {
    for (let i = 0; i < tree.nodes.length; i++) {
        if (tree.nodes[i] === null) {
            return i;
        }
    }

    return tree.nodes.length;
}

export function addUnder(tree: TreeStore<unknown>, parent: TreeNode<unknown>, nodeToAdd: TreeNode<unknown>) {
    insertAt(tree, parent, nodeToAdd, parent.childIds.length);
}

export function addBefore(tree: TreeStore<unknown>, child: TreeNode<unknown>, nodeToAdd: TreeNode<unknown>) {
    const parent = getParent(tree, child);
    if (!parent) {
        throw new Error("Invalid to addBefore a node without a parent");
    }

    insertAt(tree, parent, nodeToAdd, child.idxInParentList);
}

export function addAfter(tree: TreeStore<unknown>, child: TreeNode<unknown>, nodeToAdd: TreeNode<unknown>) {
    const parent = getParent(tree, child);
    if (!parent) {
        throw new Error("Invalid to addAfter a node without a parent");
    }

    insertAt(tree, parent, nodeToAdd, child.idxInParentList + 1);
}


export function insertAt(tree: TreeStore<unknown>, parent: TreeNode<unknown>, nodeToAdd: TreeNode<unknown>, idx: number) {
    addAsRoot(tree, nodeToAdd);
    const nodeToAddIdx = nodeToAdd.id;
    
    nodeToAdd.parentId = parent.id;
    parent.childIds.splice(idx, 0, nodeToAddIdx);
    reindexChildren(tree, parent, idx);
}

// Removes an entire subtree from the tree. 
export function removeSubtree(tree: TreeStore<unknown>, nodeToDelete: TreeNode<unknown>) {
    if (!hasNode(tree, nodeToDelete.id)) {
        return;
    }

    const queue = [nodeToDelete];
    let queuePos = 0;
    while (queuePos < queue.length) {
        const node = queue[queuePos];
        queuePos += 1;

        // removal code will pop from the end of the list, so it's more efficient to 
        // remove a bunch of things from the end of the child list.
        for (let i = node.childIds.length - 1; i >= 0; i--) {
            const idx = node.childIds[i];
            const childNode = getNode(tree, idx);
            queue.push(childNode);
        }

        // We can't call remove() here, since we've already removed the parent, and it will fail.
        // That's ok, because we can just delete the nodes from the tree and not worry about the other stuff
        // we usually had to do, since those nodes are all deleted as well...
        remove(tree, node);
    }
}
