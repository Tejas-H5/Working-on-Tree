## 2026-05 - Journal pivot

Prior to today, the app was structured in this way:

```
Area 1:
    Note Tree
        - This is the main area
    Sidebar
        - Activity panel, it can be iterated
        - Finder panel
        - Quick Traversal
    Bottom panel
        - Usually closed
        - Duration timesheet
Area 2:
    Graph
        - Create a bunch of text boxes, and arrows pointing at each other. Really 
            nice to sketch out diagrams and such. It's a singleton though
Area 3:
    Journal
        - New! shiny!
        - Write a large wall of text.
        - This wall of text can have children underneath it
Area 4:
    Settings and admin, import/export, whatnot
```

The note tree, sidebar widget, and duration view all interact with one-another. 
The note tree was the main area.
What I found after using this program for 3 years, was that once you accumulate a LOT of notes, it becomes
very difficult to traverse the tree.

- There are a LOT of DONE tasks that never get cleaned up. They are useful for record keep though (or so I thought)
- There are a LOT of tasks that I have forgotten to mark as DONE

This means that I end up working on a lot of features that try to address this problem.
The SHELVED status is a way to completely ignore an entire subtree in the note tree
The 'marks' are a way to bookmark and quickly traverse between seperate points in the tree.
The Quick Traversal feature is just a way to simplify a massive tree, and traverse the simplified version.

This problem got so bad that I started just creating a single note, where I would maintain a textual structure like

```
- [x] Item 1
    - [x] Item 2
    - [x] Item 3
- [ ] Item 4
- [ ] Item 5
```

Isn't this the kind of thing that I wanted to bring structure to with this UI? 
The fact that I fell back onto this mode of keeping notes, means that the idea, while it looked like it was working initially, was ultimately a failure. 
I'm quite glad that I didn't ship this and get a bunch of people using it. 
Anyway, this immedeately led me to accomodate this new usage patter by creating the "Journal" in a weekend. (No AI, just too much spare time apparently).
This immediately fixed the issue. My notes were far more organised, and I was able to stay on task and remember what
needed to be done far better. The fact that I wasn't tied to a tree structure meant that I could select, move, and reorder
entire blocks of text at a time, rather than manually moving nodes one by one using the tree traversal methods.
It also meant that I almost never had a whole bunch of tombostone notes lying around. 
It was definately a lot better.
I hadn't gotten around to adding the final polishes to this thing untill around now.

The main thing that was lost, was the ability to track the specific activities I did in a finely grained manner.
But I don't think I ever cared about this to begin with. 
The 'high level task' concept - this idea that there was a higher level task with a bunch of subtasks underneath it - 
was created precicely because I don't care about granularity. 
It's funny the kind of features that you'll add to your program when you don't really understand 
the true nature of the problem, and you're trying to solve problems that you yourself created.
I have not gotten to the stage where I can detect that I am doing this yet. 
It only occured to me just now as I was typing this. I may as well get rid of this feature!

And I can even add back granular tracking by remembering the precise edits I make to each page, and when I made them.
This will be a pain to code, and probably not that useful, so I won't bother doing it. But
this would be the correct solution, I reckon, if I did in fact want this for some reason.

## The change

What I realise is that for each 'page', I can give each page it's own 'graph', it's own 'code' section, and even it's own 'TODO' section.
This is largely a compromise for simplicity - the other option is to do jupyter notebook style cells where each cell can be any type, and that is the content of every page. Maybe that is better tbh. But after this refactor, I could even give each page it's own 'cells' section that is exactly this, and if I like this more, I can migrate the fat struct `{ page, notes, graph, code } -> { cells: [{page}, {note}, {grap}, {code}] } `:


```
Area 1:
    Journal
        - Write a large wall of text - a Page
        - a Page can have children underneath it
            - Also can have a Graph, if needed
            - Also have code if needed
            - Also can have a note tree if needed
    Sidebar
        - Activity panel, it can be iterated
            - All activities are within a particular journal page, possible a subview within that page
    Bottom panel
        - Usually closed
        - Duration timesheet
Area 2:
    Settings and admin, import/export, whatnot
```

This allows me to fully leverage the Journal design for organisation, without actually having to completely throw away any of the other work that I've done so far, and I may learn a thing or two about massive refactors, and writing refactor-resiliant code from it. 

The thing I'm learning now, although it seems a bit obvious in hindsight, is that functions are much easier to reuse if 
they depend on as few inputs as possible. If you have a function like `createNote(ctx: GlobalContext)`, you're screwed if
you ever want to have multiple note trees, for example. As such, it's probably better to make sure a 
function gets as little as it needs to do it's job as possible, and then you slowly expand what you give it, rather
than giving it everything from the start, even though the latter is technically better.
I think I already learned this instinctively before this refactor in particular - the graph view for example, was very easy
to reuse for every single page. The note tree view is what I'm struggling with refactoring at the moment.
May or may not be worth it, but would be a good excersise that's for sure. 
Once I've done this refactor, I probably won't ever touch this app again - it's nearly perfect!

I'll come back when I think it's not. For example - I can't save images or videos in here.
This is due to technical limitations - I won't be able to save the entire file over and over again if I allow that,
because the state will become much larger than a couple MBs. This can be fixed by uploading images to indexeddb and 
refering to those images, but then backups will be massive, so on and so forth. I'd rather just keep things simple for now.

## But actually

It actually occurs to me, that the notes that I've collected are kinda useless. 
I never look back on them. It is too difficult to look back over them, because there are thousands of them,
and the atomisation disincentivised polishing existing notes. 

It will also take a LONG time to port them over properly, even if I decided to use AI. 
It would be produent to drop notes from note tree completely.
I'll have to rename the 'product'. 
