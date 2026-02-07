# Cybernet Call

Cybernet Call is a web-based peer-to-peer (P2P) communication application designed to enable
direct file transfer and messaging without relying on a centralized relay server.

## Overview

The primary goal of this project is to explore how P2P architectures can improve performance,
privacy, and scalability in real-world web applications.

By leveraging WebRTC for direct peer connections, Cybernet Call minimizes server-side
responsibilities and avoids common bottlenecks associated with centralized architectures.

## Key Design Decisions

### Why Peer-to-Peer (P2P)?

A P2P architecture was chosen to achieve the following goals:

- **High performance**: Direct communication reduces latency and enables faster file transfers.
- **Scalability**: Since data does not pass through a central server, the system does not require
  server-side scaling as the number of users grows.
- **Privacy and confidentiality**: Messages and files are exchanged directly between peers,
  reducing exposure to third-party infrastructure.

### Notification Strategy and PWA Constraints

While PWA push notifications were initially considered, practical limitations in browser and
platform support led to reliability concerns.

As a result, a **server-mediated email notification** mechanism was implemented as a pragmatic
alternative. This approach prioritizes reliability and usability over idealized feature completeness,
ensuring that users are still notified of important events.

This decision reflects a broader design principle used throughout the project:
**choosing stable and maintainable solutions under real-world constraints**.

## Architecture Overview

- **Frontend / Backend**: Django
- **Real-time communication**: WebRTC (P2P)
- **Hosting**: Render
- **Database / Auth**: Supabase
- **Notifications**: Email-based delivery

The server is intentionally kept lightweight, focusing on authentication, signaling,
and notification support, while all real-time data transfer occurs directly between peers.

## Trade-offs and Limitations

This project explicitly accepts several trade-offs:

- NAT traversal and connection establishment can be more complex in P2P systems.
- Push notifications are limited due to PWA constraints.
- Direct connections prioritize privacy and performance at the cost of some operational simplicity.

These trade-offs were considered acceptable given the project’s goals and use cases.

## Future Directions

Potential future improvements include:

- Enhanced connection reliability under restrictive network environments
- Alternative lightweight notification mechanisms
- Incremental improvements to signaling and connection management

## Technologies

- Django
- WebRTC
- Render
- Supabase
