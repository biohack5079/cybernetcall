from django.core.management.base import BaseCommand
from django.utils import timezone
from datetime import timedelta
from cnc.models import Mail, Notification

class Command(BaseCommand):
    help = 'Deletes data older than 30 days'

    def handle(self, *args, **options):
        retention_period = timezone.now() - timedelta(days=30)
        self.stdout.write(f"Cleaning up data older than {retention_period}...")

        # 古いメールの削除
        try:
            deleted_mails, _ = Mail.objects.filter(timestamp__lt=retention_period).delete()
            self.stdout.write(self.style.SUCCESS(f"Deleted {deleted_mails} old mails."))
        except Exception as e:
            self.stdout.write(self.style.WARNING(f"Could not delete mails (or model not found): {e}"))

        # 通知（足跡情報など）の削除
        try:
            deleted_notifications, _ = Notification.objects.filter(timestamp__lt=retention_period).delete()
            self.stdout.write(self.style.SUCCESS(f"Deleted {deleted_notifications} old notifications."))
        except Exception as e:
            self.stdout.write(self.style.WARNING(f"Could not delete notifications: {e}"))