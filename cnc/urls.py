from django.contrib import admin
from django.urls import path
from cnc import views

urlpatterns = [
    path("", views.IndexView.as_view(), name="cnc/index.html"),
]

