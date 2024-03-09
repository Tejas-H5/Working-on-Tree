# Working tree (Try it [here](https://tejas-h5.github.io/Working-on-Tree))

A lot of the time, I find myself doing things like this in notepad:

```
- [x] task1
- [x] task2
- [...] task3 big one
    - [...] subtask
        - [...] working...
```

It helps me keep track of what my progress is.
This app somewhat automates this, while streamlining the process of cleaning out 'done' tasks, as well as
tracking the exact time at which every task was created, which I might be interested in using for visualizations later.

Also, I have finally caved in to using TypeScript - it is a much better dev experience than JavaScript.
So now, this project is a Vanilla TypeScript app bundled with Vite and deployed with a custom github actions workflow (After failing to get my own pipeline working I just copied the one on the Vite website. It was very similar to what I had before, but did a few things a bit better).