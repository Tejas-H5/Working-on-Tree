// It's kinda like semver, but it doesn't really follow any convention. I bump it up by however big I feel the change I made was.
// This will need to change if this number ever starts mattering more than "Is the one I have now the same as latest?"
// 'X' will also denote an unstable/experimental build. I never push anything up if I think it will break things, but still
export const VERSION_NUMBER = "2.01.03";

// This is the 'real' version that I made because I actually needed a way to detect whether the current app is
// an 'older' version or a newer version. I'll be incrementing it each time I deploy a new version. 
// No joke - I've actually redeployed this many times. HOW
export const VERSION_NUMBER_MONOTONIC = 220;
