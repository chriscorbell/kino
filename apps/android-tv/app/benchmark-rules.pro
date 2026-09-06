# Instrumentation calls these APIs from a separate APK. R8 sees only the app's
# calls when shrinking it, so retain the additional entry points used by the gates.
-keep class app.kino.tv.** { *; }
-keep,allowoptimization class kotlin.** { *; }
-keep,allowoptimization class androidx.tracing.** { *; }
-keep,allowoptimization class androidx.compose.** { public protected *; }
-keep,allowoptimization class androidx.media3.** { public protected *; }
-keep,allowoptimization class coil3.** { public protected *; }
-keep,allowoptimization class androidx.activity.compose.** { public protected *; }
-keep,allowoptimization class androidx.tv.material3.** { public protected *; }
-keep,allowoptimization class pbandk.** { public protected *; }
-keep,allowoptimization class kotlinx.coroutines.** { public protected *; }
-keep,allowoptimization class androidx.core.view.ViewCompat {
    public static androidx.core.view.WindowInsetsCompat getRootWindowInsets(android.view.View);
}
-keep,allowoptimization class androidx.core.view.WindowInsetsCompat {
    public boolean isVisible(int);
}
-keep,allowoptimization class androidx.core.view.WindowInsetsCompat$Type {
    public static int ime();
}
