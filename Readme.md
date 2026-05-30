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

## Unique patterns

This codebase follows certain UI patterns that I've found to be comfortable as the sole end user, that
won't be common in other software projects, so I've documented them here so I don't forget.

- The vast majority of views can be navigated and controlled via the keyboard
    - This is especially important. I've made our own focusing system for added control.
    I've found it difficult to do this in other frameworks and tech stacks in the past.
- I don't care about supporting mouse
    - I pretty  much don't use the mouse for anything on this website except toggling the theme from dark <-> light mode.
- Deleting is implicit
    - The program doesn't listen to a 'delete' keypress - rather, I empty a note's text, or empty a journal's text
    and give it an empty name, and it should automatically delete itself when I move off that item.
- 0 Tests
    - Hot take: if your code needs tests, it's because it is too complicated to reason about. 
    LLMs need to write tests to develop code that humans could have developed without writing any tests.
    It is a scaffolding that it needs in order to see the world around it, and validate it's assumptions.
    However, humans can simply hover around in the air by writing code that is simple and self-evident at the callsite.
    - This is journalling app with exactly 0 complexity. I expect the core app to have exactly 0 tests forever.
- No minification of deployed output
    - It's useful to debug and fix issues in production copies of this app when I'm too lazy to release a new version,
    so the deployed code is not minified in any way.
- Indexed-DB for storage
    - This was a pain, but we've worked it out. Still not hit the 5mb cap on any of my datastores yet though. LOL
