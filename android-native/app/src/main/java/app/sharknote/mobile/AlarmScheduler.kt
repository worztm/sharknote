package app.sharknote.mobile

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Exact alarms for todos. Falls back to inexact scheduling when the OS
 * refuses exact alarms (Android 12+ revoked permission) so reminders still
 * arrive, just less precisely.
 */
object AlarmScheduler {
    const val CHANNEL_ID = "sharknote-reminders"

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(
                CHANNEL_ID, "Reminders", NotificationManager.IMPORTANCE_HIGH
            ).apply { description = "Todo alarms from Sharknote" }
            context.getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
        }
    }

    private fun pi(context: Context, id: Long): PendingIntent =
        PendingIntent.getBroadcast(
            context, id.toInt(),
            Intent(context, AlarmReceiver::class.java).putExtra("todo_id", id),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

    fun schedule(context: Context, todo: Todo) {
        if (todo.done || todo.alarmAt <= 0) { cancel(context, todo.id); return }
        ensureChannel(context)
        val am = context.getSystemService(AlarmManager::class.java)
        try {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, todo.alarmAt, pi(context, todo.id))
        } catch (e: SecurityException) {
            am.set(AlarmManager.RTC_WAKEUP, todo.alarmAt, pi(context, todo.id))
        }
    }

    fun cancel(context: Context, id: Long) {
        context.getSystemService(AlarmManager::class.java).cancel(pi(context, id))
    }

    /** Re-arm everything pending (boot, app start). Past alarms fire now. */
    fun rescheduleAll(context: Context) {
        val store = TodoStore(context)
        val now = System.currentTimeMillis()
        store.all.forEach { t ->
            if (!t.done && t.alarmAt > 0) {
                if (t.alarmAt <= now) AlarmReceiver.notifyTodo(context, t) else schedule(context, t)
            }
        }
    }
}

class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val id = intent.getLongExtra("todo_id", -1L)
        if (id < 0) return
        val todo = TodoStore(context).all.find { it.id == id } ?: return
        if (todo.done) return
        notifyTodo(context, todo)
    }

    companion object {
        fun notifyTodo(context: Context, todo: Todo) {
            AlarmScheduler.ensureChannel(context)
            val open = PendingIntent.getActivity(
                context, todo.id.toInt(),
                Intent(context, MainActivity::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val n = NotificationCompat.Builder(context, AlarmScheduler.CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("Sharknote reminder")
                .setContentText(todo.text)
                .setStyle(NotificationCompat.BigTextStyle().bigText(todo.text))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setAutoCancel(true)
                .setContentIntent(open)
                .build()
            try {
                NotificationManagerCompat.from(context).notify(todo.id.toInt(), n)
            } catch (_: SecurityException) {
                // POST_NOTIFICATIONS denied: the alarm state is still stored.
            }
        }
    }
}

/** After a reboot, AlarmManager schedules are gone; re-arm from the store. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            AlarmScheduler.rescheduleAll(context)
        }
    }
}
