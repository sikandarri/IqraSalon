import type {Metadata} from 'next';import './globals.css';
export const dynamic = 'force-dynamic';
export const metadata:Metadata={title:'Iqra Signature Salon | Bridal Studio and Spa',description:'Bridal artistry, signature hair and restorative beauty rituals. Discover Iqra Signature Salon and request your appointment.',icons:{icon:'/favicon.svg',shortcut:'/favicon.svg'}};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
