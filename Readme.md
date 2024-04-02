# Working tree (Try it [here](https://tejas-h5.github.io/Working-on-Tree))

A lot of the time, I find myself doing things like this in notepad:

```
- [x] task1
- [x] task2
- [...] task3 big one
    - [...] subtask
        - [...] working...
```

TODO:
    - We need to know what notes are 'TODO' at all points in time.
    - It should be easy to add a new TODO note and go back to what we were doing before
    - We should be able to archive tasks that we've finished, and look over them

Might need to restructure our things

Task
    - Subtask 

        


It helps me keep track of what my progress is.
This app somewhat automates this, while streamlining the process of cleaning out 'done' tasks, as well as
tracking the exact time at which every task was created, which I might be interested in using for visualizations later.


## htmlf framework

Another thing that this app is doing is stress-testing a new SPA JavaScript framework I am working on that
is designed with simplicity as it's key focus.

The main advantages are:
 - package and bundle sizes are much smaller
 - it is much easier to understand all the internal workings, at least down to the Vanilla-JS level.
 - because so few packages are needed (vite and typescript), my free tier github actions CI pipeline is only ~15 seconds
    - And I only added TypeScript because I preferred the dev experience. It will still work as Plain JS.
 - most of the code I write is still focused on the problem itself, and I probably would have had to write 80% of it anyway, even if I was using REACT.