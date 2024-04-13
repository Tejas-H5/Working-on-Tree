# Mistakes

All the code mistakes that I should avoid

```typescript
// Don't export this type, it's terrible. 
// Keeps tempting me into making form abstractions, which I should avoid until typescript introduces Exact<T>, 
// When I can add OneLevelDeepForm<T> = { [key in T]: Renderable<GenericInputArguments<T[key]>> }.
//      (it doesnt work now, because renderables need ALL their props to render correctly, 
//          but they can be implicitly downcasted into Renderable<GenericInput<T>>)
type GenericInputArguments<T> = {
    label?: string;
    value: T;
    onChange(val: T):void;
}

// Just an index into our activities array. Activities ideally never reorder.
// Except I kinda do want them to reorder soon. Even though this description is right,
// defining this type will just lead to mistakes, because I will assume that the id of an object will never change
// and write incorrect code with this assumption.
type ActivityId = number;




```


