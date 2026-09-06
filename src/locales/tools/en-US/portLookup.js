export default {
  title: 'Port Reference',
  description: 'Quick reference of common TCP and UDP ports, searchable by port number or service name',
  searchPlaceholder: 'Enter a port number or service name, e.g. 22 or ssh',
  listTitle: 'Common Ports',
  resultCount: '{n} matches',
  emptyResult: 'No matching ports. Try another keyword or category',
  note: 'Port numbers follow the official IANA registry. Always check the actual service configuration for the listening port',
  categories: {
    all: 'All',
    web: 'Web',
    email: 'Email',
    database: 'Database',
    remote: 'Remote Access',
    file: 'File Sharing',
    other: 'Other',
  },
  services: {
    ftpData: {
      name: 'FTP Data',
      desc: 'Data transfer channel of FTP active mode, works alongside the control connection on port 21',
    },
    ftp: {
      name: 'FTP',
      desc: 'Plain-text file transfer protocol for uploading and downloading files; prefer SFTP or FTPS',
    },
    ssh: {
      name: 'SSH',
      desc: 'Encrypted remote shell protocol, the standard way to administer Linux servers',
    },
    telnet: {
      name: 'Telnet',
      desc: 'Plain-text remote login protocol without encryption, largely replaced by SSH',
    },
    smtp: {
      name: 'SMTP',
      desc: 'Protocol for sending and relaying email between mail servers',
    },
    dns: {
      name: 'DNS',
      desc: 'Resolves domain names into IP addresses; TCP is used for zone transfers and large responses',
    },
    dhcpServer: {
      name: 'DHCP Server',
      desc: 'Automatically assigns IP addresses and network parameters to LAN clients',
    },
    dhcpClient: {
      name: 'DHCP Client',
      desc: 'Port on which clients receive the configuration assigned by a DHCP server',
    },
    tftp: {
      name: 'TFTP',
      desc: 'Minimal UDP-based file transfer, common for router firmware and network booting',
    },
    http: {
      name: 'HTTP',
      desc: 'The base protocol of the web; plain text and gradually replaced by HTTPS',
    },
    kerberos: {
      name: 'Kerberos',
      desc: 'Network authentication protocol used in domain environments, core of Windows Active Directory',
    },
    pop3: {
      name: 'POP3',
      desc: 'Downloads email to the local device, typically without keeping copies on the server',
    },
    ident: {
      name: 'Ident',
      desc: 'Legacy protocol that identifies the user behind a TCP connection, mostly seen with IRC',
    },
    ntp: {
      name: 'NTP',
      desc: 'Synchronizes clocks across network devices with millisecond accuracy',
    },
    rpc: {
      name: 'MSRPC Endpoint Mapper',
      desc: 'Endpoint mapping service for Windows remote procedure calls',
    },
    netbiosNs: {
      name: 'NetBIOS Name Service',
      desc: 'Resolves NetBIOS names on LANs, often probed to fingerprint Windows hosts',
    },
    netbiosDgm: {
      name: 'NetBIOS Datagram',
      desc: 'Connectionless NetBIOS datagram service used for browsing and broadcasts',
    },
    netbiosSsn: {
      name: 'NetBIOS Session',
      desc: 'NetBIOS session transport; legacy Windows file sharing depends on it',
    },
    imap: {
      name: 'IMAP',
      desc: 'Receives and manages mail on the server, keeping multiple devices in sync',
    },
    snmp: {
      name: 'SNMP',
      desc: 'Monitors and manages routers, switches and other network devices',
    },
    snmpTrap: {
      name: 'SNMP Trap',
      desc: 'Lets network devices push alerts to a management station',
    },
    bgp: {
      name: 'BGP',
      desc: 'Backbone protocol that exchanges routing information between autonomous systems',
    },
    ldap: {
      name: 'LDAP',
      desc: 'Queries and maintains directory information, common in enterprise identity systems',
    },
    https: {
      name: 'HTTPS',
      desc: 'TLS-encrypted HTTP, the standard protocol of modern websites',
    },
    smb: {
      name: 'SMB',
      desc: 'Windows file and printer sharing protocol, also known as CIFS',
    },
    smtps: {
      name: 'SMTPS',
      desc: 'SMTP submission over implicit TLS',
    },
    syslog: {
      name: 'Syslog',
      desc: 'Centrally collects logs from network devices and services',
    },
    submission: {
      name: 'SMTP Submission',
      desc: 'Standard port for mail clients to send messages, usually with STARTTLS',
    },
    ldaps: {
      name: 'LDAPS',
      desc: 'LDAP over TLS, keeping all directory traffic encrypted',
    },
    rsync: {
      name: 'rsync',
      desc: 'Incremental file synchronization daemon; pair it with SSH for safety',
    },
    ftps: {
      name: 'FTPS',
      desc: 'FTP over implicit TLS',
    },
    imaps: {
      name: 'IMAPS',
      desc: 'IMAP over TLS with fully encrypted mail content',
    },
    pop3s: {
      name: 'POP3S',
      desc: 'POP3 over TLS with encrypted mail downloads',
    },
    socks: {
      name: 'SOCKS Proxy',
      desc: 'General-purpose proxy protocol that forwards arbitrary TCP traffic',
    },
    openvpn: {
      name: 'OpenVPN',
      desc: 'Default port of the open-source VPN service, providing TLS-encrypted tunnels',
    },
    mssql: {
      name: 'Microsoft SQL Server',
      desc: 'Default listen port of Microsoft SQL Server',
    },
    oracle: {
      name: 'Oracle Database',
      desc: 'Default listener port (TNS) of Oracle Database',
    },
    pptp: {
      name: 'PPTP',
      desc: 'Control channel of the legacy VPN protocol; weak security, an upgrade is recommended',
    },
    mqtt: {
      name: 'MQTT',
      desc: 'Lightweight IoT publish and subscribe protocol without TLS',
    },
    nfs: {
      name: 'NFS',
      desc: 'Network File System for sharing directories between Unix-like systems',
    },
    zookeeper: {
      name: 'ZooKeeper',
      desc: 'Distributed coordination service, common with Kafka and microservice registries',
    },
    docker: {
      name: 'Docker API (no TLS)',
      desc: 'Unencrypted Docker remote API; extremely dangerous to expose to the internet',
    },
    dockerTls: {
      name: 'Docker API (TLS)',
      desc: 'TLS-encrypted port of the Docker remote API',
    },
    squid: {
      name: 'Squid Proxy',
      desc: 'Default port of the Squid HTTP forward proxy',
    },
    mysql: {
      name: 'MySQL',
      desc: 'Default port of MySQL and MariaDB; never expose it directly to the internet',
    },
    rdp: {
      name: 'Remote Desktop',
      desc: 'Graphical remote administration protocol of Windows (RDP)',
    },
    postgresql: {
      name: 'PostgreSQL',
      desc: 'Default listen port of PostgreSQL',
    },
    sip: {
      name: 'SIP',
      desc: 'Signaling protocol for VoIP voice and video sessions',
    },
    amqp: {
      name: 'AMQP',
      desc: 'Standard protocol port of message brokers such as RabbitMQ',
    },
    vnc: {
      name: 'VNC',
      desc: 'Cross-platform remote desktop viewing and control',
    },
    redis: {
      name: 'Redis',
      desc: 'In-memory key-value store; exposing it without a password is very risky',
    },
    httpAlt: {
      name: 'HTTP Alternate',
      desc: 'Common alternate port for web apps and proxies such as Tomcat or Nginx',
    },
    httpsAlt: {
      name: 'HTTPS Alternate',
      desc: 'Common alternate HTTPS port, often used by admin consoles',
    },
    kafka: {
      name: 'Kafka',
      desc: 'Client port of the Kafka distributed message queue',
    },
    elasticsearch: {
      name: 'Elasticsearch',
      desc: 'Default port of the Elasticsearch REST API',
    },
    memcached: {
      name: 'Memcached',
      desc: 'Distributed memory cache; its UDP mode has been abused for amplification attacks',
    },
    mongodb: {
      name: 'MongoDB',
      desc: 'Default port of the MongoDB document database',
    },
    minecraft: {
      name: 'Minecraft Server',
      desc: 'Default port of Minecraft Java Edition servers',
    },
  },
}
