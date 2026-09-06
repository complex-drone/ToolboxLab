export default {
  title: '端口参考',
  description: '常用 TCP/UDP 端口号与服务速查表，支持按端口号或服务名搜索',
  searchPlaceholder: '输入端口号或服务名，例如 22 或 ssh',
  listTitle: '常用端口列表',
  resultCount: '匹配 {n} 条',
  emptyResult: '没有匹配的端口，换个关键词或分类试试',
  note: '端口号以 IANA 官方注册为准，实际服务监听端口请以目标服务器配置为准',
  categories: {
    all: '全部',
    web: '网页',
    email: '邮件',
    database: '数据库',
    remote: '远程访问',
    file: '文件共享',
    other: '其他',
  },
  services: {
    ftpData: {
      name: 'FTP 数据连接',
      desc: 'FTP 主动模式的数据传输端口，与 21 端口的控制连接配合使用',
    },
    ftp: {
      name: 'FTP 文件传输',
      desc: '明文文件传输协议，用于上传下载文件，建议改用 SFTP 或 FTPS',
    },
    ssh: {
      name: 'SSH 安全外壳',
      desc: '加密的远程登录与管理协议，是 Linux 服务器运维的标准方式',
    },
    telnet: {
      name: 'Telnet 远程登录',
      desc: '明文远程登录协议，不加密，已基本被 SSH 取代',
    },
    smtp: {
      name: 'SMTP 邮件发送',
      desc: '邮件发送与中继协议，负责邮件服务器之间投递信件',
    },
    dns: {
      name: 'DNS 域名解析',
      desc: '将域名解析为 IP 地址，TCP 用于区域传送与大体积响应',
    },
    dhcpServer: {
      name: 'DHCP 服务器',
      desc: '向局域网客户端自动分配 IP 地址等网络参数',
    },
    dhcpClient: {
      name: 'DHCP 客户端',
      desc: '客户端接收 DHCP 服务器分配结果的端口',
    },
    tftp: {
      name: 'TFTP 简单文件传输',
      desc: '基于 UDP 的极简文件传输，常用于路由器固件与无盘启动',
    },
    http: {
      name: 'HTTP 超文本传输',
      desc: '网页浏览的基础协议，明文传输，正逐步被 HTTPS 取代',
    },
    kerberos: {
      name: 'Kerberos 认证',
      desc: '域环境下的网络身份认证协议，Windows 活动目录的核心组件',
    },
    pop3: {
      name: 'POP3 邮件接收',
      desc: '把邮件下载到本地的收信协议，默认不在服务器保留副本',
    },
    ident: {
      name: 'Ident 身份识别',
      desc: '识别 TCP 连接所属用户的古老协议，现多见于 IRC 场景',
    },
    ntp: {
      name: 'NTP 网络时间同步',
      desc: '为网络设备提供毫秒级的时钟同步服务',
    },
    rpc: {
      name: '微软 RPC 端点映射',
      desc: 'Windows 远程过程调用的端点映射服务',
    },
    netbiosNs: {
      name: 'NetBIOS 名称服务',
      desc: '局域网内的 NetBIOS 名称解析，常被用于探测 Windows 主机',
    },
    netbiosDgm: {
      name: 'NetBIOS 数据报',
      desc: 'NetBIOS 无连接数据报服务，用于局域网浏览与广播',
    },
    netbiosSsn: {
      name: 'NetBIOS 会话服务',
      desc: 'NetBIOS 会话传输，旧版 Windows 文件共享依赖此端口',
    },
    imap: {
      name: 'IMAP 邮件接收',
      desc: '在服务器端管理邮件的收信协议，适合多设备同步',
    },
    snmp: {
      name: 'SNMP 网络管理',
      desc: '监控与管理路由器、交换机等网络设备的协议',
    },
    snmpTrap: {
      name: 'SNMP Trap 陷阱',
      desc: '网络设备主动向管理站上报告警事件的端口',
    },
    bgp: {
      name: 'BGP 边界网关协议',
      desc: '在自治系统之间交换路由信息的骨干协议',
    },
    ldap: {
      name: 'LDAP 目录服务',
      desc: '查询与维护目录信息，常见于企业统一账号管理',
    },
    https: {
      name: 'HTTPS 安全超文本传输',
      desc: '基于 TLS 加密的 HTTP，现代网站的标准协议',
    },
    smb: {
      name: 'SMB 文件共享',
      desc: 'Windows 文件与打印机共享协议，也称 CIFS',
    },
    smtps: {
      name: 'SMTPS 隐式加密发送',
      desc: '基于 TLS 的 SMTP 发信端口（隐式 SSL）',
    },
    syslog: {
      name: 'Syslog 系统日志',
      desc: '集中收集网络设备与服务运行日志的协议',
    },
    submission: {
      name: 'SMTP 提交端口',
      desc: '邮件客户端发信的标准端口，通常配合 STARTTLS 使用',
    },
    ldaps: {
      name: 'LDAPS 加密目录',
      desc: '基于 TLS 的 LDAP，目录通信全程加密',
    },
    rsync: {
      name: 'rsync 同步',
      desc: '增量文件同步与备份守护进程，建议配合 SSH 使用',
    },
    ftps: {
      name: 'FTPS 隐式加密 FTP',
      desc: '基于 TLS 的 FTP（隐式 SSL）',
    },
    imaps: {
      name: 'IMAPS 加密收信',
      desc: '基于 TLS 的 IMAP，邮件内容全程加密',
    },
    pop3s: {
      name: 'POP3S 加密收信',
      desc: '基于 TLS 的 POP3，邮件下载全程加密',
    },
    socks: {
      name: 'SOCKS 代理',
      desc: '通用代理协议，可转发任意 TCP 流量',
    },
    openvpn: {
      name: 'OpenVPN',
      desc: '开源 VPN 服务的默认端口，提供 TLS 加密隧道',
    },
    mssql: {
      name: 'Microsoft SQL Server',
      desc: '微软数据库的默认监听端口',
    },
    oracle: {
      name: 'Oracle 数据库',
      desc: 'Oracle 数据库默认监听端口（TNS）',
    },
    pptp: {
      name: 'PPTP VPN',
      desc: '老式 VPN 协议的控制通道，安全性较弱，建议升级',
    },
    mqtt: {
      name: 'MQTT 物联网消息',
      desc: '轻量级物联网消息发布订阅协议（非 TLS 版本）',
    },
    nfs: {
      name: 'NFS 网络文件系统',
      desc: '类 Unix 系统之间共享目录的协议',
    },
    zookeeper: {
      name: 'ZooKeeper',
      desc: '分布式协调服务，常见于 Kafka 与微服务注册中心',
    },
    docker: {
      name: 'Docker API（无 TLS）',
      desc: 'Docker 远程 API 的未加密端口，暴露公网极度危险',
    },
    dockerTls: {
      name: 'Docker API（TLS）',
      desc: 'Docker 远程 API 的 TLS 加密端口',
    },
    squid: {
      name: 'Squid 代理',
      desc: 'Squid HTTP 正向代理的默认端口',
    },
    mysql: {
      name: 'MySQL 数据库',
      desc: 'MySQL 与 MariaDB 的默认端口，切勿直接暴露公网',
    },
    rdp: {
      name: '远程桌面 RDP',
      desc: 'Windows 远程桌面的图形化管理协议',
    },
    postgresql: {
      name: 'PostgreSQL 数据库',
      desc: 'PostgreSQL 数据库的默认监听端口',
    },
    sip: {
      name: 'SIP 会话发起',
      desc: 'VoIP 语音与视频会话的信令协议',
    },
    amqp: {
      name: 'AMQP 消息队列',
      desc: 'RabbitMQ 等消息中间件的标准协议端口',
    },
    vnc: {
      name: 'VNC 远程桌面',
      desc: '跨平台的远程桌面查看与控制协议',
    },
    redis: {
      name: 'Redis 缓存',
      desc: '内存键值数据库，未设置密码时暴露公网风险极高',
    },
    httpAlt: {
      name: 'HTTP 备用端口',
      desc: '常见的 Web 应用与代理备用端口（Tomcat、Nginx 等）',
    },
    httpsAlt: {
      name: 'HTTPS 备用端口',
      desc: '常见的 HTTPS 备用端口，多用于管理后台',
    },
    kafka: {
      name: 'Kafka',
      desc: 'Kafka 分布式消息队列的客户端端口',
    },
    elasticsearch: {
      name: 'Elasticsearch',
      desc: '搜索引擎 REST API 的默认端口',
    },
    memcached: {
      name: 'Memcached',
      desc: '分布式内存缓存服务，UDP 模式曾被用于反射放大攻击',
    },
    mongodb: {
      name: 'MongoDB',
      desc: 'MongoDB 文档数据库的默认端口',
    },
    minecraft: {
      name: 'Minecraft 服务器',
      desc: 'Minecraft Java 版服务器的默认端口',
    },
  },
}
