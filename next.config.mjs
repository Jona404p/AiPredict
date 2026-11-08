/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'api.sofascore.com',
        pathname: '/api/v1/team/*/image',
      },
      {
        protocol: 'https',
        hostname: 'sofascore-team-image.s3.eu-west-1.amazonaws.com',
      },
      {
        protocol: 'https',
        hostname: 'crests.football-data.org',
      },
    ],
    // Permitir cualquier imagen externa con unoptimized en caso de logos de equipos
    unoptimized: false,
  },
  // Headers para mejorar caché de imágenes de logos
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
        ],
      },
    ]
  },
}

export default nextConfig
