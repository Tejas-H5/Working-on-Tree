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

Another thing I've found is that chrome has a bug which causes indexedDB to grow to an unbounded size.
My indexedDB grew to 15GB in production, causing chrome to crash whenever it even attempted to read data from
this database. Hence, I would recommend NOT using chrome or any chromium based browser to run this program.
I have added code to the program to detect and flag this issue if it ever starts happening to you.
