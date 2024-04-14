/**
 * import { Renderable, el, makeComponent } from "./dom-utils";

type HelpItems = {
    title: string;
    text: string;
    component?: Renderable;
}


export const helpItems: HelpItems[] = [
    { 
        title: "How do I use this web app?",
        text: `I made this web-app to make it easier for me to track what I'm working on, as well as to measure the time I've spent working on particular tasks.
Over the next several 'slides' I will explain this in more detail, as well as how to use the app.`,
        component: makeComponent(
            el("B", {}, ["NOTE: If you just want to know what all the functionality is without long explanations, you might want the 'cheatsheet?' instead"]), 
            () => {}
        ),
    },
    {
        title: "Why did I make this web app? 1/3",
        text: `I used to use notepad/a similar text editor to do this, where it was common for me to end up with a deeply nested tree structure with dot points. 
This works quite well for a bit, but as items pile up, it becomes very hard to see what I'm working on at the moment, what my priority tasks are, what my current progress in a particular task is, what components I've actually already completed but forgot to delete from this list, what sub-tasks fell out of main tasks, etc. 
It occurred to me that I could make a fairly simple web UI that lets me keep track of all of these things.`
    },
    {
        title: "Why did I make this web app? 2/3",
        text: `There is also a tangential problem that I figured I could solve. At the end of the day, I don't really know how long I've spent on each task I've worked on. Luckily this doesn't matter very much for now, but the problem of tracking this is actually very hard, and the reason has nothing to do with software. Rather, it's because most approaches to tracking this require me to manually stop/start timers, and if I forget to do this once, the data becomes basically un-useable. The current 'state of the art' seems to be a linear list where you specify the start and end of each thing you worked on (think of a typical time-tracking software that a typical office job might use, like Harvest). If you're constantly moving back and forth between various tasks, responding to things on the fly, you need something that lets you log entries quickly, and fix up any mistakes in the data later when you inevitably forget to set something.
        I believe that the solution to this problem will be fixed by reconciling a time-tracking software with the note-taking software as mentioned in the previous help text. That is basically what I've made here. `
    },
    {
        title: "Why did I make this web app? 3/3",
        text: "This program is actually somewhat close to becoming stable, with future versions being backwards compatible. That's enough rambling, let's talk about how to actually use this program"
    },
    { 
        title: "[Currently working on] section - Creating and editing notes - The basics",
        text: `You will be writing all your notes under the heading "Currently working on". 
        If you've freshly opened this page, there should be a single note there that says "First Note". 
        Click on it, and press [Enter] to start editing it.
        Once you're done, press [Enter] (new-lines can instead be inputted with [Shift + Enter]). 
        This will create a new note under it, which you will already be editing. 
        This is mainly useful for logging a constant stream of thoughts, which is sometimes useful.
        Each note also logs the date/time at which it was created (on the left), as well as how long you've spent on it, and all notes under it (on the right).`,
    },
    { 
        title: "[Currently working on] section - Creating and editing notes - Vertical movement",
        text: `Press [Escape] to stop editing a note without creating more notes. 
            Move to other notes using the [Up] / [Down] arrows. 
            You can hold [Ctrl] at the same time to quickly move to notes that are in progress (denoted with [...]). 
            You can also use [Page-up] and [Page-down]  or [Home] and [End] to move a bit faster`,
    },
    { 
        title: "[Currently working on] section - Creating and editing notes - Tree structure",
        text: `You can also add notes 'under' a particular note by pressing [Shift] + [Enter] when you aren't editing a note. 
        At any point in time, you can only see notes 'above' and on the same level as the current note. 
        This is mainly to make it easier to focus on the current task.
        You can move in/out of the tree levels using left/right arrows.`,
    },
    { 
        title: "Moving around the tree",
        text: "",
    },
    { 
        title: "The basics",
        text: "The final position of the note isn't fixed. You can move it around the tree using the movement keys while holding [Alt]",
    },
    {
        title: "The TODO List, and TODO Tasks",
        text: `You will notice that as you make a string of tasks underneath a task, they become greyed out. 
        The program assumes you're finished with that task, and have moved on to the next task. 
        There are some instances where this assumption is incorrect. 
        A quick way to prevent a task from greying out is by starting it with a * at the start.
        Another way is to start the note with the text TODO. 
        This is typically how I use it, as it will add the task to the todo list, where you can quickly view and access tasks that are in progress. 
        Additionally, tasks can be grouped into priority bubbles using ! and ?. 
        While a normal TODO task has a priority of 0, a TODO! task has a priority of 1, TODO!! has p=2, and conversely, TODO? has p=-1. 
        There is no limit to the number of ??? or !! that can be used.`,
    },
    { 
        title: "The activity list, and analytics",
        text: "You will notice that each task you create will be appended to the Activity List. This list is separate from the note tree, and tracks what you're spending your time on at any given point in time. You can use [Ctrl] + [Shift] + left/right arrows to move back and forth through this list. It will also be more relevant to the Analytics page later.",
    },

    // TODO: explain the following:
    // analytics
    // taking breaks
    // the scratch pad, and loading/saving JSON to and from the scratch pad
    // text export?
];
*/