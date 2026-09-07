# Sharknote R8/ProGuard rules
# The app is pure Kotlin + Compose with no reflection, so the default
# optimized rules cover almost everything. Keep what little there is:

# Compose runtime keeps its own members; nothing else needs reflection.
-dontwarn androidx.compose.**

# Strip Kotlin metadata that aids decompilers but is unused at runtime.
# (Keep kotlin classes functional; only drop debug source names.)
-repackageclasses 'a'
-optimizations !code/simplification/arithmetic,!field/*,!class/merging/*

# Never obfuscate the Activity referenced by the manifest (AGP keeps it
# automatically, but be explicit):
-keep class app.sharknote.mobile.MainActivity { <init>(); }
