import { Link } from 'react-router';

interface Props {
  actionText?: string;
}

export function RequireLoginBlock({ actionText = "TO VIEW ACCOUNT INFO" }: Props) {
  return (
    <div style={{ padding: '30px 0', textAlign: 'center', lineHeight: '1.6' }}>
      <div className="text-sec" style={{ letterSpacing: '-3px', overflow: 'hidden' }}>
        ◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢
      </div>
      
      <br />
      
      <div className="text-ter">{actionText}</div>
      <div className="text-sec">
        <Link to="/login" className="text-primary">LOGIN</Link> OR
      </div>
      <div>
        <Link to="/signup" className="text-primary">『SIGN UP HERE』</Link>
      </div>
      
      <br />
      
      <div className="text-sec" style={{ letterSpacing: '-3px', overflow: 'hidden' }}>
        ◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢◤◢
      </div>
    </div>
  );
}
