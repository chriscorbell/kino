package app.kino.tv

import android.content.Intent
import android.os.Bundle
import android.os.Process
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge

open class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (redirectToAccount()) return
        enableEdgeToEdge()
        val app = application as KinoApplication
        setContent {
            KinoTheme {
                KinoApp(
                    app.core,
                    app.accountProcess,
                    onSignIn = { startActivity(Intent(this, AccountActivity::class.java)) },
                    onAccountLinked = {
                        java.io.File(filesDir, "active-account").writeText("account")
                    },
                    onCancelAccount = { finish() },
                    onSignOut = {
                        java.io.File(filesDir, "active-account").delete()
                        getSharedPreferences("stremio-core-account", MODE_PRIVATE)
                            .edit()
                            .clear()
                            .commit()
                        startActivity(
                            Intent(this, MainActivity::class.java)
                                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
                        )
                        finish()
                        // Only the account process exits. The guest Core and its storage remain
                        // intact.
                        Process.killProcess(Process.myPid())
                    },
                )
            }
        }
    }

    override fun onResume() {
        super.onResume()
        if (!isFinishing) redirectToAccount()
    }

    private fun redirectToAccount(): Boolean {
        if (
            !(application as KinoApplication).accountProcess &&
                java.io.File(filesDir, "active-account").exists()
        ) {
            startActivity(Intent(this, AccountActivity::class.java))
            finish()
            return true
        }
        return false
    }
}

class AccountActivity : MainActivity()
