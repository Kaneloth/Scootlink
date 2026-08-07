package co.za.skootlink.app;

import android.os.Bundle;
import android.view.View;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Required by @capacitor-community/safe-area — tells Android to
        // actually draw content edge-to-edge natively, which the plugin
        // then reports back to the WebView as correct env(safe-area-inset-*)
        // values. Without this, Android 15+ (API 35+, enforced regardless
        // of what this app does) can push content — including the app's
        // own header — under the status bar with no way for CSS to know
        // how much space to leave, since insets were never being detected
        // as edge-to-edge in the first place.
        EdgeToEdge.enable(this);

        // Lock the WebView's text zoom to exactly 100%, so it stops following
        // the device's own system font-scale / display-size accessibility
        // setting. Without this, text can render larger than the actual CSS
        // values specify, on any device with that setting above default —
        // independent of anything in our own stylesheets.
        getBridge().getWebView().getSettings().setTextZoom(100);

        // Disables Android's native WebView "overscroll glow" effect — the
        // vertical bounce reported on some devices. This is a separate
        // layer from CSS's overscroll-behavior (which only stops the page
        // content itself from rubber-banding); the native glow effect is
        // controlled by the WebView's own Java API and isn't reachable
        // from CSS at all, which is why the existing overscroll-behavior:
        // none rule in index.css alone hasn't fully solved this.
        getBridge().getWebView().setOverScrollMode(View.OVER_SCROLL_NEVER);
    }
}
