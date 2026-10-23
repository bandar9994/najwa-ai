// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

package com.bandar9994.balimda;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LlamaPlugin.class);
        registerPlugin(GoogleAuthPlugin.class);
        registerPlugin(VoicePlugin.class);
        registerPlugin(NetPlugin.class);
        registerPlugin(BrowsePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
