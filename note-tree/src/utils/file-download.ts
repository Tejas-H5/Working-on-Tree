// Source: https://web.dev/patterns/files/save-a-file
// You install npm packages. I copy-paste code from the internet into my own project. We are not the same
const saveFile = async (blob: Blob, suggestedName: string) => {
    // Feature detection. The API needs to be supported
    // and the app not run in an iframe.
    const supportsFileSystemAccess = 'showSaveFilePicker' in window &&
        (() => {
            try {
                return window.self === window.top;
            } catch {
                return false;
            }
        })();

    // If the File System Access API is supported…
    if (supportsFileSystemAccess) {
        try {
            // @ts-ignore Show the file save dialog.
            const handle = await showSaveFilePicker({
                suggestedName,
            });
            // Write the blob to the file.
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
            return;
        } catch (err: any) {
            // Fail silently if the user has simply canceled the dialog.
            if (err.name !== 'AbortError') {
                console.error(err.name, err.message);
                return;
            }
        }
    }
    // Fallback if the File System Access API is not supported…
    // Create the blob URL.
    const blobURL = URL.createObjectURL(blob);

    // Create the `<a download>` element and append it invisibly.
    const a = document.createElement('a');
    a.href = blobURL;
    a.download = suggestedName;
    a.style.display = 'none';
    document.body.append(a);

    a.click();

    setTimeout(() => {
        // Revoke the blob URL and remove the element.
        URL.revokeObjectURL(blobURL);
        a.remove();
    }, 1000);
};

export function saveText(text: string, suggestedName: string) {
    const fileBlob = new Blob([text], { type: "text/plain" });
    saveFile(fileBlob, suggestedName);
}

/**
 * I wonder why I couldn't find this one on the internet anywhere...
 */
export function loadFile(handler: (file:File | null) => void) {
    const uploadInput = document.createElement("INPUT") as HTMLInputElement;
    uploadInput.setAttribute("type", "file");
    // I wonder if this will work in production environment tbh...
    // document.body.append(uploadInput);
    uploadInput.click();
    uploadInput.addEventListener("change", () => {
        const file = uploadInput.files?.[0];
        if (!file) {
            handler(null);
        } else {
            handler(file);
        }
        // uploadInput.remove();
    });
}

