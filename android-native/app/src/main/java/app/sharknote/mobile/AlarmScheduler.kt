package app.sharknote.mobile

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

/**
 * Exact alarms for todos. Notifications are real system notifications via
 * NotificationCompat over a high-importance channel (the androidx.core
 * notification API), scheduled by AlarmManager — reminders fire with the app
 * closed, and a battery-optimization exemption is requested so aggressive
 * OEM power managers (ColorOS on OPPO) don't swallow the broadcast.
 */
object AlarmScheduler {
    const val CHANNEL_ID = "sharknote-reminders"
    const val EXTRA_TODO_ID = "todo_id"

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(
                CHANNEL_ID, "Reminders", NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Todo alarms from Sharknote"
                enableLights(true)
                enableVibration(true)
            }
            context.getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
        }
    }

    /** Ask the user to whitelist us from battery optimization (OPPO/Xiaomi). */
    fun requestIgnoreBatteryOptimizations(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val pm = context.getSystemService(PowerManager::class.java)
            if (pm != null && !pm.isIgnoringBatteryOptimizations(context.packageName)) {
                runCatching {
                    context.startActivity(
                        Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                            .setData(android.net.Uri.parse("package:${context.packageName}"))
                            .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                    )
                }.onFailure {
                    // Some OEMs block the direct dialog; send them to settings.
                    runCatching {
                        context.startActivity(
                            Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                                .setData(android.net.Uri.parse("package:${context.packageName}"))
                                .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
                        )
                    }
                }
            }
        }
    }

    private fun pi(context: Context, id: Long, action: String): PendingIntent =
        PendingIntent.getBroadcast(
            context, id.toInt() + action.hashCode() % 1000,
            Intent(context, AlarmReceiver::class.java)
                .setAction(action)
                .putExtra(EXTRA_TODO_ID, id),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    fun schedule(context: Context, todo: Todo) {
        if (todo.done || todo.alarmAt <= 0) { cancel(context, todo.id); return }
        ensureChannel(context)
        val am = context.getSystemService(AlarmManager::class.java)
        val intent = pi(context, todo.id, AlarmReceiver.ACTION_FIRE)
        try {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, todo.alarmAt, intent)
        } catch (e: SecurityException) {
            // Exact-alarm permission absent: inexact still arrives, just less precise.
            am.setWindow(AlarmManager.RTC_WAKEUP, todo.alarmAt, 10 * 60_000L, intent)
        }
    }

    fun cancel(context: Context, id: Long) {
        val am = context.getSystemService(AlarmManager::class.java)
        am.cancel(pi(context, id, AlarmReceiver.ACTION_FIRE))
    }

    /** Re-arm everything pending (boot, app start). Past-due un-fired alarms fire now. */
    fun rescheduleAll(context: Context) {
        val store = TodoStore(context)
        val now = System.currentTimeMillis()
        store.all.forEach { t ->
            if (!t.done && t.alarmAt > 0) {
                if (t.alarmAt <= now && !t.alarmFired) AlarmReceiver.fire(context, t)
                else if (t.alarmAt > now) schedule(context, t)
            }
        }
    }
}

class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getLongExtra(AlarmScheduler.EXTRA_TODO_ID, -1L)
        if (id < 0) return
        val todo = TodoStore(context).get(id) ?: return
        when (intent.action) {
            ACTION_SNOOZE10 -> {
                val snoozeStore = TodoStore(context)
                val at = System.currentTimeMillis() + 10 * 60_000L
                snoozeStore.reschedule(id, at)
                snoozeStore.get(id)?.let { AlarmScheduler.schedule(context, it) }
                cancelNotification(context, id)
            }
            else -> if (!todo.done) fire(context, todo)
        }
    }

    companion object {
        const val ACTION_FIRE = "app.sharknote.mobile.ALARM"
        const val ACTION_SNOOZE10 = "app.sharknote.mobile.SNOOZE10"

        /** Notify, and auto-complete the todo the moment it is delivered. */
        fun fire(context: Context, todo: Todo) {
            val store = TodoStore(context)
            store.markAlarmDone(todo.id)
            AlarmScheduler.cancel(context, todo.id)
            notifyTodo(context, todo)
        }

        fun notifyTodo(context: Context, todo: Todo) {
            AlarmScheduler.ensureChannel(context)
            val open = PendingIntent.getActivity(
                context, todo.id.toInt(),
                Intent(context, MainActivity::class.java)
                    .putExtra(AlarmScheduler.EXTRA_TODO_ID, todo.id),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val snooze = PendingIntent.getBroadcast(
                context, todo.id.toInt() + 5000,
                Intent(context, AlarmReceiver::class.java)
                    .setAction(ACTION_SNOOZE10)
                    .putExtra(AlarmScheduler.EXTRA_TODO_ID, todo.id),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val n = NotificationCompat.Builder(context, AlarmScheduler.CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("Reminder · ${todo.text}")
                .setContentText("Marked done. Snooze 10 min or open to reschedule.")
                .setStyle(NotificationCompat.BigTextStyle().bigText(
                    "${todo.text}\nMarked done. Snooze 10 min, or open to set a new time."))
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setSound(android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_ALARM))
                .setVibrate(longArrayOf(0, 500, 250, 500))
                .setFullScreenIntent(open, true)
                .setAutoCancel(true)
                .setContentIntent(open)
                .addAction(0, "Snooze 10 min", snooze)
                .addAction(0, "Open", open)
                .build()
            try {
                NotificationManagerCompat.from(context).notify(todo.id.toInt(), n)
            } catch (_: SecurityException) {
                // POST_NOTIFICATIONS denied on 13+: state is still marked done.
            }
        }

        private fun cancelNotification(context: Context, id: Long) {
            NotificationManagerCompat.from(context).cancel(id.toInt())
        }
    }
}

/** After a reboot, AlarmManager schedules are gone; re-arm from the store. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            val pending = goAsync()
            Thread {
                try {
                    AlarmScheduler.rescheduleAll(context)
                } finally {
                    pending.finish()
                }
            }.start()
        }
    }
}
