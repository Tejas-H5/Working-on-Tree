# Note Tree (Try it [here](https://tejas-h5.github.io/Working-on-Tree))

A lot of the time, I find myself doing things like this in notepad:

```
- [x] task1
- [x] task2
- [...] task3 big one
    - [...] subtask
        - [...] working...
```

It doesn't last for very long, because the tree of notes becomes very unwieldy very quickly.
However, this process was the inspiration for this web app, which is a hybrid of a note-taking/jounralling program, 
and a time tracking tool with some features for tracking time estimates as well.

The html page can be downloaded and use offline.


# Some good findings

The idea of an 'activity list' is also quite a good one. In fact, what I have found is that simply by placing timestamps in arbitrary places directly in a linear text document,
we can retroactively associate certain parts of that document with higher level tasks, and infer the sorted list of activities as well as the time spent on each higher level task, with
a bit of smart parsing. For example, with a document like this:


```
Task:
    <timestamp 1> - doin da thing
    <timestamp 3> - reworking some stuff


Task 2:
    <timestamp 2> - doin another thing
```

We can generate a report like this:

```

Activities:

<timestamp 1> [Task] - doing da thing (<timestamp 2 - timestamp 1>hrs)
<timestamp 2> [Task 2] - doin another thing (<timestamp 3 - timestamp 2>hrs)
<timestamp 3> [Task 1] - reworking some stuff

Times:

Task: <timestamp 2 - timetamp 1> + <timestamp 3 - now()> hrs
Task 2: <timestamp 3 - timestamp 2> hrs

```

And this turns out to be a great way to keep track of what we're doing in the day, but it is somewhat limited, in that we can't really 
get an insight into the overall work spent on a specific task. 

## 2025-07 rewrite

I've decided to rewrite this app to a new framework to:

a) [x] prove out the new framework
b) [x] make some minor improvements over existing functionality:

- All menus no longer need a mouse for interaction, and can be navigated to and used with a keyboard (in fact, there is basically 0 mouse interaction now)
- Entire state no longer recomputes whenever I type something. Performance has substantially increased. (Although this could have been done in other ways while retaining the old framework, I'm sure).
- All commands are now discoverable. 
    - But I made the program, so I already know all the commands. This was mainly an idea I was thinking of, which I finally realised how to implement.
- Activity view, finder view, timesheet view, and URL view can now be navigated via keyboard, and even cross-reference the tree view

c) [x] Add some features that were sorely lacking:

- Entire tree can now be traversed in most-recently-edited order
- Entire subtrees can now be shelved with a SHELVED note. This is now a real status, unlike a boolean as before. We use this to make it easier to mark entire subtrees as no longer in progress, but not yet complete. 

However, in order to reduce scope and get it finished, I've decided to completely remove a substantial number of features.
Some were because I never really used them that much:

- Estimates, estimate aggregation
- task streams, task schedule, estimating the time of completion of a schedule taking workdays into acount
- Arbitrary date range activity aggregation
- Graph view

However, the canvas view was just too time-consuming to port, and not really worth it even though I used it quite often.
After all, I can just draw on my notebook, or even do similar diagrams with vim bindings.
There are better ways to implement the same thing, so I'm not going to bother porting it accross. 


