# Working tree (Try it [here](https://tejas-h5.github.io/Working-on-Tree))

A lot of the time, I find myself doing things like this in notepad:

```
- [x] task1
- [x] task2
- [...] task3 big one
    - [...] subtask
        - [...] working...
```

There are a couple of problems with this:

- This doesn't scale. when I add more and more tasks, it is easy for it to get overwhelming
- It is hard to track task priority. When I look at this, I never know what it is I am going to work on next
- I end up storing a 'diary' of my progress in this notepad, or for adding things like links, git branches, jira card numbers, etc. and while helpful at the time, it clutters the tree and makes things even more overwhelming
- Sometimes as I am working on things, I find new things that need to be worked on. It is really easy to forget them. and adding them to the structure only makes things more overwhelming

This note tree solves these problems in the following ways:

- All notes are automatically collapsed unless you are inside a particular note
- writing 'TODO' at the start of a note adds it to a priority queue that you can re-order at will

This actually wasn't the original problem I was trying to solve. What I really wanted was a program that tracks when I make each 'diary entry', and tracks how long I spend on each task based on the time differences. 
This web app attempts to solve both of these problems at the same time:

- Every activity you create is tracked
- Every activity you move to is also tracked
- The timings will eventually be used to generate a report that should allow you to see how long you are spending on things
- The biggest problem with all time reporting software is that I will always forget to use it, so I have to just guess what it was I was doing and when I was doing it a lot of the time.
The way this sidesteps this problem is by also solving the previous task tracking problem described above.
Because I am actually using this thing to keep track of what I am working on for myself, the problem of forgetting to report what I was doing to some other system is sidestepped. 

## Why aren't you using a popular web framework like React?

I am also trying to see how far I can go with just VanillaJS and core principles of software design.
I bet that it doesn't really matter what framework you use if you know how to organise your code properly, and this is also a way to test that hypothesis.