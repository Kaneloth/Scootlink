package co.za.skootlink.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Lock the WebView's text zoom to exactly 100%, so it stops following
        // the device's own system font-scale / display-size accessibility
        // setting. Without this, text can render larger than the actual CSS
        // values specify, on any device with that setting above default —
        // independent of anything in our own stylesheets.
        getBridge().getWebView().getSettings().setTextZoom(100);
    }
}
