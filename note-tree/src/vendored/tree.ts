
// This tree is supposed to be JSON-serializable. 
// T is an index into the TreeStore which stores the actual data, rather than an in-memory reference

// to the node object.
// NOTE: in hindsight, this is a bit of a blunder caused by mindlessness. There's no reason to use uuids here - we should have just used
// an index into an array. I could change it but I would need to create migration scripts.
export type TreeNode<T> = {
    id: string;
    parentId: string | null;
    childIds: string[];
    data: T;
} 

// Surely this won't collide with a user's id, right? 
// 1 year later: it never did. Because why would the uuid generator make this? strange comment.
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

export function forEachParent<T>(tree: TreeStore<T>, node: TreeNode<T>, fn: (node: TreeNode<T>) => void | boolean) : boolean {
    while (node.parentId) {
        if (fn(node)) {
            return true;
        }
        node = getNode(tree, node.parentId);
    }
    return false;
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
    if (hasNode(tree, node.parentId)) {
        const parent = getNode(tree, node.parentId);
        const idx = parent.childIds.indexOf(node.id);
        if (idx === -1) {
            throw new Error("Possible data corruption");
        }
        parent.childIds.splice(idx, 1);
    }

    // clear out the parent
    node.parentId = null;

    // remove it from the tree
    delete tree.nodes[node.id];
}

/**
 * Right now you will need to call this on notes that you make, if you want it to be a root note.
 * This is because right now, the add and remove functions will remove this note from the tree store, to prevent
 * redundant notes from being in there.
 */
export function addAsRoot(tree: TreeStore<unknown>, node: TreeNode<unknown>) {
    remove(tree, node);

    tree.nodes[node.id] = node;
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

// Removes an entire subtree from the tree. 
export function removeSubtree(tree: TreeStore<unknown>, nodeToDelete: TreeNode<unknown>) {
    if (!hasNode(tree, nodeToDelete.id)) {
        return;
    }

    remove(tree, nodeToDelete);

    const stack = [ nodeToDelete ];
    while (stack.length > 0) {
        const node = stack.pop()!; // stack.length > 0

        if (node.childIds.length > 0) {
            for (const id of node.childIds) {
                const childNode = getNode(tree, id);
                stack.push(childNode);
            }
        }

        // We can't call remove() here, since we've already removed the parent, and it will fail.
        // That's ok, because we can just delete the nodes from the tree and not worry about the other stuff
        // we usually had to do, since those nodes are all deleted as well...
        delete tree.nodes[node.id];
    }
}
