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


## File structure

We haven't introduced AI to this codebase yet, but when we do, surely this will be helpful.
That being said, I may never introduce AI to any of my codebases - while it might speed things up, 
it takes a lot of the fun out of programming.

```
note-tree/
    various_configs_files.blah

    src/
        main.ts             entrypoint
        schema.ts           parse/save the current savefile
        state.ts            functions relating to the current program state
        global-context.ts   TODO: merge state.ts and global-context.ts
        app-styling.ts      Self explanatory
        version-number.ts   Bump this whenever we release a new version or update the schema in a non-compatible way

        app-views/          main.ts and state.ts may be broken up into 'views' that we put into here, either for code reuse or to simplify or organise the code better. Views are tightly coupled to the app. If they aren't, we can just make them an app component or a normal component.

        app-components/     components reused accross this app
        app-utils/          utils reused accross this app
        assets/             anything more data than code, including massive constants
        components/         components copy-pasted accross multiple projects
        utils/              utils copy-pasted accross multiple projects
        legacy-components/  TODO (Me): port these, put them into `components/`. The checkbox in particular was pretty cool if I remember correctly.
```

TODO (CRITICAL): Fix how we handle the scenario where multiple tabs are open at once. The way we do it now isn't quite right

While this code is mostly finished, I will still be making fixes and adding some simple features, as I think of them.
Turns out that having an app in 'production' running your framework is very useful for testing changes to the framework.

