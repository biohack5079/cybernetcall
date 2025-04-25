from django.urls import path
from cnc import views

urlpatterns = [
    path("", views.IndexView.as_view(), name="index"),
]

